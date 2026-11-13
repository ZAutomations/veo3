"""Optional narration providers and timeline-preserving audio replacement."""
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.request
import urllib.error
import urllib.parse
import uuid

STORE = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Veo3Studio' / 'voiceover'
PROVIDERS = {'elevenlabs': ('https://api.elevenlabs.io', 'xi-api-key'),
             'ai33pro': ('https://api.openspeaker.ai', 'xi-api-key')}

def audio_duration(file):
    import video_editing as E
    data=json.loads(E.run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',file]).stdout)
    if not any(s.get('codec_type')=='audio' for s in data.get('streams',[])): raise ValueError('Voiceover file has no audio stream.')
    duration=float(data.get('format',{}).get('duration') or 0)
    if not __import__('math').isfinite(duration) or duration<=0: raise ValueError('Voiceover audio has no valid duration.')
    return duration

def configure(provider, key):
    if provider == 'google':
        import google_tts
        google_tts.configure(key)
        return
    if provider == 'heygen':
        import heygen_audio
        heygen_audio.configure(key)
        return
    if provider not in PROVIDERS: raise ValueError('Choose a supported voice provider.')
    if key:
        STORE.mkdir(parents=True, exist_ok=True)
        (STORE / (provider+'.json')).write_text(json.dumps({'key':str(key).strip()}),encoding='utf-8')

def call(provider, route, payload=None):
    base, header = PROVIDERS[provider]
    try: key=json.loads((STORE/(provider+'.json')).read_text(encoding='utf-8'))['key']
    except (OSError,ValueError,KeyError): raise ValueError(f'Save the {provider} API key first.')
    req=urllib.request.Request(base+route,headers={header:key,'Content-Type':'application/json'},
        data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with urllib.request.urlopen(req,timeout=120) as r:
            body=r.read()
            return json.loads(body) if 'json' in r.headers.get('Content-Type','') else body
    except urllib.error.HTTPError as exc:
        raise ValueError(f'{provider} HTTP {exc.code}: '+exc.read().decode(errors='replace').replace(key,'[hidden]')[:400]) from None
    except OSError: raise ValueError(f'{provider} connection failed; no automatic generation retry was sent.') from None

def voices(provider):
    if provider == 'google':
        import google_tts
        return google_tts.voices()
    if provider=='heygen':
        import heygen_audio
        return heygen_audio.voices()
    result=call(provider,'/v1/voices' if provider=='elevenlabs' else '/v3/voices')
    data=result.get('voices',result.get('data',[]))
    if isinstance(data,dict): data=data.get('voices',[])
    return [{'voice_id':v.get('voice_id',v.get('id','')), 'name':v.get('name','Voice')} for v in data]

def synthesize(provider, voice, text, target, language=None):
    target=Path(target)
    if target.is_file() and target.stat().st_size: return target
    if provider=='google':
        import google_tts
        return google_tts.synthesize(voice,text,target,language)
    if provider=='heygen':
        import heygen_audio
        receipt=target.with_suffix('.heygen.json')
        saved=json.loads(receipt.read_text()) if receipt.is_file() else {}
        if not saved:
            saved={'idempotency_key':str(uuid.uuid4()),'created':time.time()}
            receipt.write_text(json.dumps(saved))
        result=saved.get('response')
        if not result:
            if time.time()-saved['created']>23*3600:
                raise ValueError('HeyGen request status is uncertain and its safe retry window expired. Check the provider history before submitting again.')
            print('HeyGen: requesting narration with a saved retry identity...',flush=True)
            result=heygen_audio.speech(voice,text,idempotency_key=saved['idempotency_key'])
            saved['response']=result
            temp=receipt.with_suffix('.tmp');temp.write_text(json.dumps(saved));temp.replace(receipt)
        else: print('HeyGen: reusing completed speech response; downloading its audio without another generation request.',flush=True)
        url=(result.get('data') or {}).get('audio_url')
    elif provider=='elevenlabs':
        audio=call(provider,'/v1/text-to-speech/'+urllib.parse.quote(voice,safe=''),
            {'text':text,'model_id':'eleven_multilingual_v2'})
        if not isinstance(audio,bytes): raise ValueError('ElevenLabs did not return audio.')
        target.write_bytes(audio); return target
    else:
        taskfile=target.with_suffix('.task.json')
        if taskfile.is_file(): result=json.loads(taskfile.read_text())
        else:
            result=call(provider,'/v3/text-to-speech',{'text':text,'voice_id':voice,'speed':1})
            taskfile.write_text(json.dumps(result))
        task=result.get('task_id') or (result.get('data') or {}).get('task_id')
        if not task: raise ValueError('AI33Pro did not return a task_id; inspect the saved task receipt.')
        for _ in range(120):
            result=call(provider,'/v1/task/'+urllib.parse.quote(str(task),safe=''))
            data=result.get('data') or result
            status=str(data.get('status','')).lower()
            if status in ('failed','error'): raise ValueError('AI33Pro speech task failed; inspect the provider dashboard.')
            url=data.get('audio_url') or (data.get('metadata') or {}).get('audio_url')
            if url: break
            time.sleep(5)
        else: raise ValueError('AI33Pro task still pending; retry resumes the saved task without submitting again.')
    if not isinstance(url,str) or not url.startswith('https://'): raise ValueError('Provider did not return an HTTPS audio URL.')
    temp=target.with_suffix('.download')
    for attempt in range(3):
        try:
            print(f'{provider}: downloading narration audio ({attempt+1}/3)...',flush=True)
            with urllib.request.urlopen(url,timeout=45) as response, temp.open('wb') as output:
                while True:
                    chunk=response.read(65536)
                    if not chunk: break
                    output.write(chunk)
            if not temp.stat().st_size: raise OSError('Empty response')
            temp.replace(target);break
        except OSError:
            temp.unlink(missing_ok=True)
            if attempt==2:
                from heygen_audio import HeyGenNetworkError
                error = HeyGenNetworkError if provider == 'heygen' else ValueError
                raise error(f'{provider} audio download timed out/failed. The generation response is saved; Retry / Continue resumes the download without generating speech again.') from None
            time.sleep(attempt+1)
    return target

def signature(cfg, source=None, report=None):
    paths=[cfg.get('voiceover_file'),cfg.get('voiceover_timing')]
    if source and cfg.get('voiceover_mode')!='native':
        paths += list(source.parent.glob('*_story.json'))
        paths.append(Path(report) if report else source.parent/'JOINED_CLIP_ORDER.txt')
    return [(str(p),Path(p).stat().st_size,Path(p).stat().st_mtime_ns) for p in paths if p and Path(p).is_file()]

def replace_audio(source, output, cfg, work, report=None):
    import video_editing as E
    mode=cfg['voiceover_mode'];info=E.probe(source)
    end=E.original_end_card_start(source,report) or info['duration']
    plans=[]
    if mode=='prepared':
        story=json.loads(Path(cfg['_audio_first_story']).read_text(encoding='utf-8-sig'))
        starts=[0.]+[t for t in E.original_boundaries(source,report) if t<end-.01]
        if len(starts)!=len(story['scenes']): raise ValueError('Audio First needs verified scene boundaries before mixing.')
        for scene,start,stop in zip(story['scenes'],starts,starts[1:]+[end]):
            audio=Path(scene['audio_first_file'])
            plans.append((audio,0.,audio_duration(audio),start,stop))
    elif mode=='api':
        stories=list(source.parent.glob('*_story.json'))
        if len(stories)!=1: raise ValueError('API narration needs exactly one story JSON beside the raw joined video.')
        story=json.loads(stories[0].read_text(encoding='utf-8-sig'))
        if story.get('narration_scope')=='dialogue' or story.get('narrated') is False:
            raise ValueError('API narrator mode supports narrated stories only; use local audio for multi-speaker dialogue.')
        starts=[0.]+[t for t in E.original_boundaries(source,report) if t<end-.01]
        scenes=story['scenes']
        if len(starts)!=len(scenes): raise ValueError('External narration requires a verified join report with one boundary per story scene.')
        voice=cfg['voiceover_voice'].strip()
        if not voice: raise ValueError('Choose a voice ID for API narration.')
        if any(not str(scene.get('script_line') or '').strip() for scene in scenes):
            raise ValueError('Every scene must contain narration before API audio can be generated.')
        cache=work.parent/'voiceover_audio';cache.mkdir(exist_ok=True)
        for i,(scene,start,stop) in enumerate(zip(scenes,starts,starts[1:]+[end])):
            text=str(scene.get('script_line') or '').strip()
            if not text: raise ValueError(f'Scene {i+1} has no narration text.')
            digest=hashlib.sha256(json.dumps([cfg['voiceover_provider'],voice,text]).encode()).hexdigest()
            audio=synthesize(cfg['voiceover_provider'],voice,text,cache/(digest+'.mp3'))
            plans.append((audio,0.,audio_duration(audio),start,stop))
    else:
        audio=Path(cfg['voiceover_file']).expanduser().resolve()
        if audio.suffix.lower() not in ('.wav','.mp3') or not audio.is_file(): raise ValueError('Choose an existing WAV or MP3 voiceover file.')
        duration=audio_duration(audio)
        if cfg['voiceover_timing']:
            # Explicit map: audio_start/audio_end -> video_start/video_end.
            rows=json.loads(Path(cfg['voiceover_timing']).read_text(encoding='utf-8-sig'))
            for row in rows: plans.append((audio,float(row['audio_start']),float(row['audio_end']),float(row['video_start']),float(row['video_end'])))
        else:
            if abs(duration-end)>max(.25,end*.02):
                raise ValueError(f'Local voiceover is {duration:.2f}s, story video is {end:.2f}s. Supply a timing JSON to align scenes; full-track matching permits only 2% drift.')
            plans=[(audio,0.,duration,0.,end)]
    if not plans: raise ValueError('No narration segments were supplied.')
    args=['ffmpeg','-v','error','-y','-i',source];filters=[];last=0.
    for i,(audio,a,b,start,stop) in enumerate(plans):
        if not all(__import__('math').isfinite(v) for v in (a,b,start,stop)) or a<0 or b<=a or start<last-.001 or stop<=start or stop>end+.02:
            raise ValueError('Voiceover timing rows must be finite, ordered, non-overlapping and within the story region.')
        if b>audio_duration(audio)+.02: raise ValueError('Voiceover timing exceeds the audio duration.')
        rate=max(1.,(b-a)/(stop-start))
        if rate>1.2: raise ValueError(f'Voiceover segment {i+1} needs {rate:.2f}x speed. Shorten narration or revise timings; no speech was truncated.')
        args+=['-i',audio]
        filters.append(f'[{i+1}:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS,atempo={rate},apad,atrim=duration={stop-start},adelay={round(start*1000)}:all=1[a{i}]')
        last=stop
    filters.append(''.join(f'[a{i}]' for i in range(len(plans)))+f'amix=inputs={len(plans)}:normalize=0,apad,atrim=duration={info["duration"]}[voice]')
    if mode=='prepared':
        E.run(args+['-filter_complex',';'.join(filters),'-map','[voice]','-c:a','pcm_s16le',work/'narration_timeline.wav'])
    audio_map='[voice]'
    if mode=='prepared' and info['audio']:
        filters += ['[voice]asplit=2[narr][duck]','[0:a]volume=0.35[bg]',
            '[bg][duck]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=250[quietbg]',
            f'[quietbg][narr]amix=inputs=2:normalize=0,apad,atrim=duration={info["duration"]}[mixed]']
        audio_map='[mixed]'
    args+=['-filter_complex',';'.join(filters),'-map','0:v:0','-map',audio_map,'-c:v','copy','-c:a','aac','-t',str(info['duration']),output]
    E.run(args)
    (work/'voiceover_sync.json').write_text(json.dumps([{'audio':str(p),'audio_start':a,'audio_end':b,'video_start':s,'video_end':e} for p,a,b,s,e in plans],indent=2))
    E.log(f'External narration aligned: {len(plans)} segment(s). '+('Audio First background retained with narration ducking.' if mode=='prepared' else 'Original mixed audio replaced; thumbnail region stays silent.'))
    return output
