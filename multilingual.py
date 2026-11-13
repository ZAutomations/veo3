"""Optional translated narration on verified Audio First visuals; never generates video."""
import copy, hashlib, json, os, re, shutil, sys, subprocess
from pathlib import Path
import video_editing as E
import voiceover as V
class TranslationNetworkError(RuntimeError):pass

LANGUAGES={'ru':'Russian','ar':'Arabic','hi':'Hindi','ur':'Urdu','es':'Spanish','fr':'French','de':'German','ja':'Japanese'}

def configuration(value):
    value=value or {}
    if not isinstance(value,dict):raise ValueError('Invalid multilingual settings.')
    if not isinstance(value.get('enabled',False),bool):raise ValueError('Multilingual mode must be enabled or disabled.')
    if not value.get('enabled'):return {'enabled':False,'languages':[]}
    rows=value.get('languages',[])
    if not isinstance(rows,list) or not rows:raise ValueError('Select at least one additional language.')
    result=[];seen=set()
    for row in rows:
        if not isinstance(row,dict):raise ValueError('Invalid language voice profile.')
        code=row.get('code');provider=row.get('provider','heygen');voice=str(row.get('voice','')).strip()
        if not isinstance(code,str) or code not in LANGUAGES or code in seen:raise ValueError('Choose distinct supported languages.')
        if provider not in ('heygen','elevenlabs','ai33pro') or not voice:raise ValueError(f'Choose a provider and voice ID for {LANGUAGES[code]}.')
        seen.add(code);result.append(dict(code=code,provider=provider,voice=voice))
    return {'enabled':True,'languages':result}

def atomic(file,value):
    file=Path(file);file.parent.mkdir(parents=True,exist_ok=True)
    text=json.dumps(value,ensure_ascii=False,indent=2)
    if file.is_file() and file.read_text(encoding='utf-8')==text:return
    tmp=file.with_suffix(file.suffix+'.tmp');tmp.write_text(text,encoding='utf-8');tmp.replace(file)

def translation(lines,code,seconds,out,feedback=None):
    req=Path(out).with_suffix('.request.json')
    atomic(req,dict(language=LANGUAGES[code],seconds=seconds,lines=lines,feedback=feedback,output=str(out)))
    if not Path(out).is_file():
        print(f'MULTILINGUAL: preparing {LANGUAGES[code]} script; cached English audio will be reused.',flush=True)
        try:
            proc=subprocess.run(['node',str(E.ROOT/'multilingual_translate.js'),str(req)],cwd=E.ROOT,timeout=180,
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        except subprocess.TimeoutExpired:
            raise TranslationNetworkError(f'{LANGUAGES[code]} translation timed out after 180s; cached audio preserved.') from None
        if proc.returncode:
            error_file=Path(str(out)+'.error.json')
            error=json.loads(error_file.read_text(encoding='utf-8')) if error_file.is_file() else {}
            message=error.get('message') or f'Translation worker exited with code {proc.returncode}.'
            if proc.returncode==75 or error.get('transient'):raise TranslationNetworkError(message)
            raise ValueError(message)
    data=json.loads(Path(out).read_text(encoding='utf-8'))
    if not isinstance(data,list) or len(data)!=len(lines) or any(not isinstance(t,str) or not t.strip() for t in data):raise ValueError('Translation must preserve every numbered scene.')
    return data

def prepare_scripts(story_file,settings):
    file=Path(story_file).resolve();story=json.loads(file.read_text(encoding='utf-8-sig'));cfg=configuration(settings)
    if not cfg['enabled']:return None
    if not story.get('audio_first'):raise ValueError('Multilingual versions require narration-free Audio First visuals.')
    lines=[str(s.get('external_narration') or '').strip() for s in story['scenes']]
    if not lines or any(not t for t in lines):raise ValueError('Every Audio First scene needs its original narration.')
    supplied=[dict(scene.get('narration_translations',{})) for scene in story['scenes']]
    overrides=file.parent/'multilingual_narration_overrides.json'
    if overrides.is_file():
        repair=json.loads(overrides.read_text(encoding='utf-8-sig'))
        if repair.get('story_sha256')!=hashlib.sha256(file.read_bytes()).hexdigest():raise ValueError('Narration override belongs to a changed story; review it before proceeding.')
        for code,rows in repair.get('narrations',{}).items():
            if code not in LANGUAGES or not isinstance(rows,dict):raise ValueError('Invalid language narration override.')
            for number,text in rows.items():
                if not str(number).isdigit() or not 1<=int(number)<=len(supplied) or not isinstance(text,str) or not text.strip():raise ValueError('Invalid scene narration override.')
                supplied[int(number)-1][code]=text.strip()

    for row in cfg['languages']:
        if story.get('multilingual_translation_mode')=='supplied_only' and any(not str(text.get(row['code'],'')).strip() for text in supplied):raise ValueError('Missing supplied '+LANGUAGES[row['code']]+' narration; no automatic translation requested.')
    identity=[lines,cfg,story.get('scene_seconds')]
    if any(supplied):identity.append(supplied)
    key=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()[:16]
    folder=file.parent/'multilingual'/key;folder.mkdir(parents=True,exist_ok=True)
    for row in cfg['languages']:
        output=folder/(row['code']+'_script.json')
        if all(str(text.get(row['code'],'')).strip() for text in supplied):
            atomic(output,[text[row['code']] for text in supplied]);print('MULTILINGUAL: using supplied '+LANGUAGES[row['code']]+' script; no translation call.',flush=True)
        elif not output.is_file():translation(lines,row['code'],story.get('scene_seconds',8),output)
        else:
            data=json.loads(output.read_text(encoding='utf-8'))
            if len(data)!=len(lines) or any(not isinstance(t,str) or not t.strip() for t in data):raise ValueError('Cached translation is incomplete; review '+str(output))
    atomic(folder/'manifest.json',dict(story=str(file),source_lines=lines,settings=cfg))
    return folder

def fit(audio,target,output):
    duration=V.audio_duration(audio);rate=max(1.,duration/target)
    if rate>1.10:raise ValueError(f'Narration needs {rate:.2f}x; multilingual limit is 1.10x. Revise translation, not the video.')
    if rate==1.:return audio,duration
    E.run(['ffmpeg','-v','error','-y','-i',audio,'-af',f'atempo={rate:.8f}','-ar','48000','-ac','1',output])
    if V.audio_duration(output)>target+.03:raise ValueError('Narration timing validation failed; no speech was cut.')
    return output,V.audio_duration(output)

def prepare_language_audio(story,root,profile,durations):
    manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    code=profile['code'];work=root/code;work.mkdir(exist_ok=True)
    starts=[];position=0.
    for duration in durations:starts.append(position);position+=duration
    end=position
    texts=json.loads((root/(code+'_script.json')).read_text(encoding='utf-8'));package=copy.deepcopy(story);package.pop('multilingual',None)
    audit=[]
    for i,(scene,text,start,stop) in enumerate(zip(package['scenes'],texts,starts,starts[1:]+[end])):
        limit=min(9.8 if story.get('scene_seconds')==10 else stop-start-.15,stop-start-.15)
        for attempt in range(3):
            digest=hashlib.sha256(json.dumps([profile,text]).encode()).hexdigest()[:20]
            cached=work/(digest+'.mp3')
            if not cached.exists():
                previous=next((f for f in root.parent.glob('*/'+code+'/'+digest+'.mp3') if f.is_file() and f.stat().st_size),None)
                if previous:V.audio_duration(previous);shutil.copy2(previous,cached)
            audio=V.synthesize(profile['provider'],profile['voice'],text,cached)
            actual=V.audio_duration(audio)
            if actual<=limit*1.10:break
            if story.get('multilingual_translation_mode')=='supplied_only':
                atomic(work/'TIMING_REPAIR.json',dict(language=code,scene=i+1,actual_seconds=actual,target_seconds=limit,narration=text,english=manifest['source_lines'][i],suggested_max_characters=max(1,int(len(text)*limit/actual*.92)),note='Shorten this supplied line, preserving facts; no Gemini call or speech crop was made.'))
                raise ValueError(f'{LANGUAGES[code]} scene {i+1} supplied narration is {actual:.2f}s; shorten that line to fit {limit:.2f}s. No translation call or speech cut was made.')
            if attempt==2:raise ValueError(f'{LANGUAGES[code]} scene {i+1} still exceeds its time after 3 attempts. Review the saved script; no speech was truncated.')
            text=translation([manifest['source_lines'][i]],code,limit,work/f'revised_{i+1}_{attempt}.json',dict(previous=text,actual_seconds=actual,target_seconds=limit))[0]
        audio,duration=fit(audio,limit,work/(digest+'.fitted.wav'))
        scene.update(external_narration=text,audio_first_file=str(audio),audio_first_duration=duration,script_line='',dialogue=[])
        audit.append(dict(scene=i+1,text=text,audio=str(audio),duration=duration,available=stop-start))
        atomic(work/'NARRATION_REVIEW.json',audit)
        print(f'MULTILINGUAL: {LANGUAGES[code]} scene {i+1}/{len(package["scenes"])} ready: {duration:.2f}s inside {stop-start:.2f}s; original audio cached.',flush=True)
    target=work/'localized_story.json';atomic(target,package);atomic(work/'NARRATION_REVIEW.json',audit);atomic(work/'script.json',{'language':LANGUAGES[code],'scenes':[{'scene':r['scene'],'narration':r['text']} for r in audit]})
    return work,package,audit


def preflight_audio(story_file,settings):
    file=Path(story_file).resolve();story=json.loads(file.read_text(encoding='utf-8-sig'));cfg=configuration(settings)
    if not cfg['enabled']:return None
    root=prepare_scripts(file,cfg)
    (root/'AUDIO_PREFLIGHT_READY.json').unlink(missing_ok=True)
    print('MULTILINGUAL PREFLIGHT: checking all selected language audio before Flow video generation.',flush=True)
    results=[]
    for profile in cfg['languages']:
        work,package,audit=prepare_language_audio(story,root,profile,[float(story.get('scene_seconds',8))]*len(story['scenes']))
        results.append(dict(language=profile['code'],scenes=len(audit),status='ready'))
    atomic(root/'AUDIO_PREFLIGHT_READY.json',dict(story=str(file),languages=results))
    print('MULTILINGUAL PREFLIGHT PASSED: every selected narration fits; Flow may start.',flush=True)
    return root


def render(body):
    file=Path(body['story']).resolve();story=json.loads(file.read_text(encoding='utf-8-sig'))
    cfg=configuration(body.get('multilingual') or story.get('multilingual'))
    if not cfg['enabled']:return []
    from story_output import story_title_base,story_video_path
    if not story.get('audio_first'):raise ValueError('Choose a prepared Audio First story, not a native narrated video.')
    raw=file.parent/(story_title_base(file)+' raw.mp4');report=file.parent/'JOINED_CLIP_ORDER.txt'
    if not raw.is_file() or not story_video_path(file).is_file():raise ValueError('Complete the English Audio First join/edit before rendering additional languages.')
    info=E.probe(raw);end=E.original_end_card_start(raw,report) or info['duration']
    starts=[0.]+[t for t in E.original_boundaries(raw,report) if t<end-.01]
    if len(starts)!=len(story['scenes']):raise ValueError('Multilingual rendering needs verified scene boundaries; no grid-order guessing.')
    root=prepare_scripts(file,cfg);manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'));outputs=[]
    settings=E.settings(body.get('editingSettings'));settings.update(silence_removal_enabled=False,audio_first_trim_gaps=False,preset_cta_enabled=False)
    for profile in cfg['languages']:
        code=profile['code']
        work,package,audit=prepare_language_audio(story,root,profile,[b-a for a,b in zip(starts,starts[1:]+[end])])
        local_raw=work/raw.name
        if local_raw.exists() and not os.path.samefile(raw,local_raw):
            def media_hash(p):
                h=hashlib.sha256()
                with p.open('rb') as f:
                    for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
                return h.digest()
            if media_hash(raw)!=media_hash(local_raw):local_raw.unlink()
        if not local_raw.exists():
            try:os.link(raw,local_raw)
            except OSError:shutil.copy2(raw,local_raw)
        local_report=work/'JOINED_CLIP_ORDER.txt'
        report_text=re.sub(r'^Completed video:.*$',lambda _: 'Completed video: '+str(local_raw),report.read_text(encoding='utf-8-sig'),count=1,flags=re.M)
        if not local_report.is_file() or local_report.read_text(encoding='utf-8')!=report_text:local_report.write_text(report_text,encoding='utf-8')
        for image in file.parent.glob('thumbnail_downloaded.*'):
            if image.suffix.lower() in ('.jpg','.jpeg','.png','.webp'):shutil.copy2(image,work/image.name)
        local_cfg=dict(settings,caption_language=LANGUAGES[code].lower() if code in ('ru','ar','hi','ur','ja') else 'auto')
        output=file.parent/(story_title_base(file)+' '+LANGUAGES[code]+'.mp4')
        print('MULTILINGUAL: Rendering '+LANGUAGES[code],flush=True)
        final=E.edit(local_raw,local_cfg,local_report,output)
        outputs.append(str(final));atomic(work/'completed.json',dict(output=str(final),profile=profile))
    print('MULTILINGUAL_OUTPUTS: '+json.dumps(outputs,ensure_ascii=False),flush=True)
    return outputs


def from_form(body):
    mode=body.get('multilingualMode')
    if mode not in (None,'english','multiple'):raise ValueError('Choose English only or English plus selected languages.')
    enabled=mode=='multiple' if mode is not None else bool(body.get('multilingualEnabled'))
    return configuration(dict(enabled=enabled,languages=[dict(code=code,provider=body.get('multiProvider_'+code,'heygen'),voice=body.get('multiVoice_'+code,'')) for code in LANGUAGES if body.get('multiLang_'+code)]))

if __name__=='__main__':
    try:
        body=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
        if body.get('preflight'):
            story=json.loads(Path(body['story']).read_text(encoding='utf-8-sig'));preflight_audio(body['story'],body.get('multilingual') or story.get('multilingual'))
        else:render(body)
    except TranslationNetworkError as exc:print('MULTILINGUAL TRANSIENT NETWORK FAILURE: '+str(exc),flush=True);sys.exit(1)
    except Exception as exc:print('RECOVERY_REVIEW_REQUIRED: MULTILINGUAL FAILED: '+str(exc),flush=True);sys.exit(2)
