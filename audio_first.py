"""Prepare an isolated narrated story for background-only video generation."""
from pathlib import Path
import copy
import hashlib
import json
import re
import shutil
import sys
import voiceover as V
import video_editing as E
import voice_calibration as C

def fit_story(audios,seconds,baseline=1.):
    durations=[V.audio_duration(p) for p in audios]
    rate=C.common_rate(durations,seconds,baseline)
    target=9.5 if seconds==10 else seconds-.15
    for _ in range(3):
        fitted=[]
        for audio,duration in zip(audios,durations):
            output=audio.with_name(audio.stem+'.common.wav')
            if rate==1.:output=audio
            else:E.run(['ffmpeg','-v','error','-y','-i',audio,'-af',f'atempo={rate:.10f}','-ar','48000','-ac','1',output])
            fitted.append((output,V.audio_duration(output)))
        longest=max(d for _,d in fitted)
        if longest<=target:return fitted,rate
        rate*=longest/(target-.02)
        if rate>C.MAX_RATE:break
    raise ValueError('Common story pace could not fit all scenes; review narration before video generation. No speech was cut.')

def fit_narration(audio, seconds):
    """Fit small overruns without cropping speech or altering the original audio."""
    duration=V.audio_duration(audio);target=9.5 if seconds==10 else seconds-.15
    # Reserve a small encoder tolerance inside the requested finish time.
    rate=max(1.,duration/(target-.02)) if duration>target else 1.
    if rate>C.MAX_RATE:
        raise ValueError(f'Narration is {duration:.2f}s for a {seconds}s clip and needs {rate:.2f}x speed (maximum 1.75x). Shorten narration or use a longer supported clip; no video was submitted.')
    if rate==1.: return audio,duration,rate
    fitted=audio.with_name(audio.stem+'.fitted.wav')
    for attempt in range(3):
        if rate>C.MAX_RATE: raise ValueError('Required narration speed exceeds 1.75x; no speech was cut and no video was submitted.')
        E.run(['ffmpeg','-v','error','-y','-i',audio,'-af',f'atempo={rate:.10f}','-ar','48000','-ac','1',fitted])
        actual=V.audio_duration(fitted)
        if actual<=target: break
        rate*=actual/(target-.02)
    else: raise ValueError('Full narration could not fit the requested finish time; no speech was cut and no video was submitted.')
    E.log(f'Narration timing: {duration:.2f}s -> {actual:.2f}s at {rate:.3f}x, pitch preserved; original retained.')
    if rate>1.2:E.log('Narration is accelerated above 1.20x; listen to the fitted audio before approving the video batch.')
    return fitted,actual,rate

def plan_package(body):
    source=Path(body['story']).resolve();original=json.loads(source.read_text(encoding='utf-8-sig'))
    if original.get('audio_first'): raise ValueError('This is already an Audio First package. Choose the original story to prepare another version.')
    if original.get('narration_scope')=='dialogue' or original.get('narrated') is False: raise ValueError('Audio First currently supports narrated stories; dialogue requires separate lip-sync handling.')
    start=int(body.get('from') or 1);end=int(body.get('to') or len(original['scenes']))
    if not 1<=start<=end<=len(original['scenes']): raise ValueError('Choose a valid scene range.')
    seconds=int(original.get('scene_seconds') or 8)
    if seconds not in (4,6,8,10): raise ValueError('Supported generation lengths are 4, 6, 8 and 10 seconds.')
    selected=original['scenes'][start-1:end]
    if any(not str(s.get('script_line') or '').strip() for s in selected): raise ValueError('Every selected scene needs narration.')
    if seconds==10:
        counts=[len(re.findall(r"\b[\w’'-]+\b",str(s['script_line']))) for s in selected]
        invalid=[f'scene {start+i}: {n} words' for i,n in enumerate(counts) if not 28<=n<=30]
        if invalid: raise ValueError('10-second narration must contain 28–30 words per scene before HeyGen/API generation: '+', '.join(invalid)+'. No script was rewritten and no audio request was submitted.')
    import multilingual
    multi=multilingual.configuration(body.get('multilingual'))
    if multi['enabled'] and original.get('multilingual_translation_mode')=='supplied_only':
        for row in multi['languages']:
            if any(not str(scene.get('narration_translations',{}).get(row['code'],'')).strip() for scene in selected):raise ValueError('Missing supplied '+multilingual.LANGUAGES[row['code']]+' narration. Import it before generating audio; no translation call will be made.')
    cfg=E.settings(body.get('editingSettings'))
    if cfg['voiceover_mode'] not in ('api','local'): raise ValueError('Choose API or Local audio in Video Editing and save those settings first.')
    if cfg['voiceover_mode']=='api' and not cfg['voiceover_voice'].strip(): raise ValueError('Choose an API voice ID first.')
    if cfg['voiceover_mode']=='local':
        local=Path(cfg['voiceover_file']).resolve()
        if local.suffix.lower() not in ('.wav','.mp3') or not local.is_file(): raise ValueError('Choose a local WAV/MP3.')
        duration=V.audio_duration(local)
        if cfg['voiceover_timing']:
            rows=json.loads(Path(cfg['voiceover_timing']).read_text(encoding='utf-8-sig'))
            if not isinstance(rows,list) or len(rows)!=len(selected): raise ValueError('Local timing JSON must contain one row per selected scene.')
            last=0.
            for row in rows:
                a,b=float(row['audio_start']),float(row['audio_end'])
                if not __import__('math').isfinite(a+b) or not 0<=last<=a<b<=duration+.01: raise ValueError('Local audio ranges must be ordered, non-overlapping and within the recording.')
                last=b
        elif len(selected)!=1: raise ValueError('Multi-scene local audio needs a per-scene timing JSON.')
    fingerprint=hashlib.sha256(b'actual_story_pace_v2'+source.read_bytes()+json.dumps([start,end,cfg,V.signature(cfg)],sort_keys=True).encode()).hexdigest()[:12]
    if multi['enabled']:fingerprint=hashlib.sha256((fingerprint+json.dumps(multi,sort_keys=True)).encode()).hexdigest()[:12]
    folder=source.parent/'audio_first'/fingerprint
    return dict(multilingual=multi,source=source,original=original,start=start,end=end,seconds=seconds,selected=selected,cfg=cfg,folder=folder,
                file=folder/(source.stem+'_audio_first_story.json'))

def prepare(body):
    planned=plan_package(body)
    source,original,start,end,seconds,selected,cfg,folder,file=(planned[k] for k in ('source','original','start','end','seconds','selected','cfg','folder','file'))
    folder.mkdir(parents=True,exist_ok=True)
    cache=folder/'audio';cache.mkdir(exist_ok=True)
    story=copy.deepcopy(original);story['scenes']=copy.deepcopy(selected)
    local_rows=None
    if cfg['voiceover_mode']=='local':
        local=Path(cfg['voiceover_file']).resolve()
        if local.suffix.lower() not in ('.wav','.mp3') or not local.is_file(): raise ValueError('Choose a local WAV/MP3.')
        if cfg['voiceover_timing']:
            local_rows=json.loads(Path(cfg['voiceover_timing']).read_text(encoding='utf-8-sig'))
            if len(local_rows)!=len(selected): raise ValueError('Local timing JSON must have one audio_start/audio_end row per selected scene.')
        elif len(selected)!=1: raise ValueError('For multiple local-audio scenes, supply an audio_start/audio_end timing row per selected scene. Automatic phrase alignment is not assumed.')
    profile=C.calibrate(cfg['voiceover_provider'],cfg['voiceover_voice'],seconds) if cfg['voiceover_mode']=='api' else None
    audit=[];audios=[];original_durations=[]
    for i,scene in enumerate(story['scenes']):
        text=scene['script_line'].strip();audio=cache/f'scene_{i+1:03}.wav'
        if cfg['voiceover_mode']=='api':
            if not cfg['voiceover_voice']: raise ValueError('Choose an API voice ID first.')
            raw=V.synthesize(cfg['voiceover_provider'],cfg['voiceover_voice'],text,cache/f'scene_{i+1:03}.source.mp3')
            E.run(['ffmpeg','-v','error','-y','-i',raw,'-ar','48000','-ac','1',audio])
        else:
            row=local_rows[i] if local_rows else {'audio_start':0,'audio_end':V.audio_duration(local)}
            a,b=float(row['audio_start']),float(row['audio_end'])
            if not 0<=a<b<=V.audio_duration(local)+.01: raise ValueError('Local audio range is invalid.')
            E.run(['ffmpeg','-v','error','-y','-ss',str(a),'-i',local,'-t',str(b-a),'-ar','48000','-ac','1',audio])
        audios.append(audio);original_durations.append(V.audio_duration(audio))
    fitted,tempo=fit_story(audios,seconds)
    E.log(f'Common narration pace for all {len(audios)} scenes: {tempo:.3f}x. No individual scene speed overrides.')
    for i,(scene,(audio,duration),original_duration) in enumerate(zip(story['scenes'],fitted,original_durations)):
        text=scene['script_line'].strip()
        scene.update(external_narration=text,script_line='',dialogue=[],audio_first_duration=duration,audio_first_file=str(audio),_scene_number=i+1)
        # Existing shot beats keep their relative proportions across the actual spoken duration.
        for shot in scene.get('shots',[]):
            shot['start_seconds']=round(float(shot['start_seconds'])/seconds*duration,3)
            shot['end_seconds']=round(float(shot['end_seconds'])/seconds*duration,3)
        if scene.get('shots'): scene['shots'][-1]['end_seconds']=seconds
        scene.pop('veo3_prompt',None);scene['sound']='Natural ambience and action-matched SFX only; no speech, vocals or music.'
        audit.append({'scene':i+1,'original_scene':start+i,'narration':text,'original_audio_seconds':original_duration,'audio_seconds':duration,'tempo':tempo,'video_seconds':seconds,'shots':scene.get('shots',[])})
    story.update(audio_first=True,narrated=False,narration_scope='none',flow_voice='',flow_voices=[],original_story=str(source),total_scenes=len(selected))
    story['audio_first_common_pace']=tempo
    story['audio_first_voice_calibration']=profile
    for key in ('zack_ready_import','script_import'): story[key]=False
    file=folder/(source.stem+'_audio_first_story.json')
    if planned['multilingual']['enabled']:story['multilingual']=planned['multilingual']
    file.write_text(json.dumps(story,ensure_ascii=False,indent=2),encoding='utf-8')
    if planned['multilingual']['enabled']:
        import multilingual
        multilingual.preflight_audio(file,planned['multilingual'])
    for name in ('refs.json','character_sheets.txt'):
        if (source.parent/name).is_file(): shutil.copy2(source.parent/name,folder/name)
    (folder/'AUDIO_FIRST_REVIEW.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    E.run(['node',str(E.ROOT/'story_to_agent_prompt.js'),file])
    print('AUDIO_FIRST_STORY: '+str(file),flush=True)
    print('Batch audio package ready; the queued Flow step will use this JSON automatically. Original story and clips preserved.' if body.get('batch') else 'Review AUDIO_FIRST_REVIEW.json, then select this new story in Agent Mode and use a NEW Flow project. Original story and clips preserved.',flush=True)
    return file

if __name__=='__main__':
    from multilingual import TranslationNetworkError
    try: prepare(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig')))
    except TranslationNetworkError as exc: print('AUDIO FIRST TRANSIENT NETWORK FAILURE: '+str(exc)+' Cached narration preserved; Retry / Continue resumes translation.',flush=True);sys.exit(1)
    except Exception as exc: print('RECOVERY_REVIEW_REQUIRED: AUDIO FIRST FAILED: '+str(exc),flush=True);sys.exit(1)
