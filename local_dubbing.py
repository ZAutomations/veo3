"""Local-only multilingual batch: supplied scripts + existing verified videos, no Veo."""
import copy,hashlib,json,os,re,shutil,subprocess,sys
from pathlib import Path
import multilingual as M
import video_editing as E
import voiceover as V
from story_output import safe_story_title,publish_audio_first_exports

SKIP={'audio_first','multilingual','local_dubbing','clips','video_editing','backups','.git','.venv'}

def read(file):return json.loads(Path(file).read_text(encoding='utf-8-sig'))
def english(scene):
    turns=scene.get('dialogue_translations',{}).get('en') or scene.get('dialogue')
    return json.dumps([(t['speaker'],t['line']) for t in turns],ensure_ascii=False) if turns else str(scene.get('external_narration') or scene.get('script_line') or '').strip()
def identity(story):return [str(story.get('title','')).strip().casefold(),story.get('preset_id') or story.get('style_preset') or '',[re.sub(r'\s+',' ',english(s)).strip() for s in story.get('scenes',[])]]
def link(source,target):
    source=Path(source).resolve();target=Path(target)
    if target.exists():
        if os.path.samefile(source,target):return
        from speech_background import identity as media_hash
        if media_hash(source)==media_hash(target):return
        target.unlink()
    try:os.link(source,target)
    except OSError:shutil.copy2(source,target)

def documents(folder):
    result=[]
    for file in sorted(Path(folder).rglob('*')):
        if not file.is_file() or file.stat().st_size>10*1024*1024 or any(p in SKIP for p in file.relative_to(folder).parts[:-1]):continue
        if file.name=='local_dubbing_jobs.json':continue
        if file.suffix.lower()=='.json':
            try:data=read(file)
            except (OSError,ValueError):continue
            if isinstance(data,dict) and isinstance(data.get('scenes'),list) and data.get('title') and any(x.get('narration_translations') or x.get('dialogue_translations') for x in data['scenes']):result.append((file,data))
        elif file.suffix.lower()=='.txt':
            text=file.read_text(encoding='utf-8-sig')
            if not re.search(r'^\s*Preset:\s*\S+',text,re.M|re.I) or not re.search(r'^\s*(?:Narration|Dialogue) (?:Russian|Arabic|Urdu|Japanese|Hindi|German|French|Spanish):',text,re.M|re.I):continue
            r=subprocess.run(['node',str(E.ROOT/'local_dubbing_import.js'),str(file)],capture_output=True,text=True,encoding='utf-8',cwd=E.ROOT,timeout=60,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if r.returncode:raise ValueError('Script import failed: '+str(file)+' '+r.stderr[-1500:])
            result.extend((file,data) for data in json.loads(r.stdout))
    unique={}
    for file,data in result:
        key=json.dumps(data,sort_keys=True,ensure_ascii=False)
        if key not in unique:unique[key]=(file,data)
    return list(unique.values())

def media_for(original,story):
    title=safe_story_title(story.get('title'),original.parent.name)
    # A completed Audio First package offers a truly clean background and verified timeline.
    for package in sorted(original.parent.glob('audio_first/*/*_story.json'),key=lambda p:p.stat().st_mtime_ns,reverse=True):
        data=read(package)
        if data.get('audio_first') and identity(data)[2]==identity(story)[2]:
            raw=package.parent/(title+' raw.mp4');final=package.parent/(title+'.mp4');report=package.parent/'JOINED_CLIP_ORDER.txt'
            if raw.is_file() and final.is_file() and report.is_file():return raw,final,report,True
    final=original.parent/(title+'.mp4');raw=original.parent/(title+' raw.mp4');report=original.parent/'JOINED_CLIP_ORDER.txt'
    if final.is_file():return (raw if raw.is_file() else final),final,report,False
    return None

def timeline(video,report,count,explicit=None):
    info=E.probe(video)
    if explicit is not None:
        if not isinstance(explicit,list) or len(explicit)!=count:raise ValueError('Explicit timeline needs one start/end row per supplied scene.')
        rows=[];end=0.
        for i,row in enumerate(explicit,1):
            a,b=float(row['start']),float(row['end'])
            if row.get('scene',i)!=i or abs(a-end)>.03 or not a<b<=info['duration']+.03:raise ValueError('Explicit scene timeline must be consecutive, start at zero and stay inside the source video.')
            rows.append([a,b]);end=b
        return rows,info
    end=E.original_end_card_start(video,report) or info['duration'];starts=[0.]+[x for x in E.original_boundaries(video,report) if x<end-.01]
    if len(starts)!=count:raise ValueError('Verified scene boundaries unavailable for '+str(video)+'. Supply explicit scene timings in local_dubbing_jobs.json; scene order/duration will not be guessed.')
    return [[a,b] for a,b in zip(starts,starts[1:]+[end])],info

def plan(body):
    folder=Path(body.get('folder','')).expanduser().resolve()
    if not str(body.get('folder','')).strip() or not folder.is_dir():raise ValueError('Choose an existing folder of translated story scripts.')
    cfg=M.configuration(body.get('multilingual'))
    if not cfg['enabled']:raise ValueError('Select the desired additional languages and voice profiles first.')
    maps=body.get('speaker_voices') or {}
    if isinstance(maps,str):maps=json.loads(maps or '{}')
    if not isinstance(maps,dict) or any(not isinstance(rows,dict) or any(not isinstance(v,str) or not v.strip() for v in rows.values()) for rows in maps.values()):raise ValueError('Speaker voices must be a JSON object of language → speaker → voice ID/name.')
    docs=documents(folder)
    if not docs:raise ValueError('No translated story JSON or ready-import TXT found in the selected folder.')
    jobfile=folder/'local_dubbing_jobs.json';bindings=read(jobfile).get('jobs',[]) if jobfile.is_file() else []
    originals=[]
    for p in (E.ROOT/'stories').rglob('*_story.json'):
        if any(x in SKIP for x in p.relative_to(E.ROOT/'stories').parts[:-1]):continue
        try:data=read(p)
        except (OSError,ValueError):continue
        if isinstance(data,dict) and data.get('scenes'):originals.append((p,data))
    jobs=[];seen=set()
    for script,supplied in docs:
        if not supplied.get('scenes'):continue
        for profile in cfg['languages']:
            code=profile['code']
            for i,scene in enumerate(supplied['scenes'],1):
                if scene.get('dialogue_translations'):
                    turns=scene['dialogue_translations'].get(code);base=scene['dialogue_translations'].get('en') or scene.get('dialogue')
                    if not turns or [t['speaker'] for t in turns]!=[t['speaker'] for t in base]:raise ValueError(f'{supplied["title"]}: {code} scene {i} must retain every speaker in order.')
                    selected=maps.get(code,{})
                    speakers=set(t['speaker'] for t in turns)
                    if any(not selected.get(n) for n in speakers):raise ValueError(f'{supplied["title"]}: set explicit {code} voice names/IDs for speakers '+', '.join(sorted(speakers)))
                    if len({selected[n] for n in speakers})!=len(speakers):raise ValueError('Dialogue speakers need distinct selected voices.')
                elif not str(scene.get('narration_translations',{}).get(code,'')).strip():raise ValueError(f'{supplied["title"]}: missing supplied {M.LANGUAGES[code]} scene {i}; local dubbing never calls translation.')
        binding=next((b for b in bindings if b.get('title')==supplied['title']),{})
        if binding.get('video'):
            resolve=lambda value:(folder/value).resolve()
            video=resolve(binding['video']);final=video;original=resolve(binding.get('original_story',str(script)))
            report=resolve(binding['order_report']) if binding.get('order_report') else video.parent/'JOINED_CLIP_ORDER.txt';clean=False
            if binding.get('background_video'):video=resolve(binding['background_video']);clean=True
            if not video.is_file() or not final.is_file():raise ValueError('Explicit source video is missing.')
        else:
            matches=[]
            for original,data in originals:
                if identity(data)==identity(supplied):
                    media=media_for(original,data)
                    if media:matches.append((original,media))
            if len(matches)!=1:raise ValueError(f'{supplied["title"]}: found {len(matches)} matching completed English projects. Keep the English text/title/preset unchanged, or bind a video explicitly in local_dubbing_jobs.json.')
            original,(video,final,report,clean)=matches[0]
        rows,info=timeline(video,report,len(supplied['scenes']),binding.get('timeline'))
        semantic=[identity(supplied),[(x.get('narration_translations',{}),x.get('dialogue_translations',{})) for x in supplied['scenes']]]
        key=json.dumps([str(original.resolve()),semantic,cfg,rows,str(video.resolve()),maps],sort_keys=True,ensure_ascii=False)
        digest=hashlib.sha256(key.encode()).hexdigest()[:16]
        if digest in seen:continue
        seen.add(digest)
        jobs.append(dict(title=supplied['title'],script=str(script),supplied=supplied,original_story=str(original.resolve()),video=str(video.resolve()),english_video=str(final.resolve()),timeline=rows,duration=info['duration'],clean_background=clean,key=digest,speaker_voices=maps))
    if not jobs:raise ValueError('No matching local dubbing jobs.')
    return dict(folder=str(folder),multilingual=cfg,jobs=jobs)


def scene_audio(scene,profile,code,work,limit,speaker_voices):
    if scene.get('dialogue_translations'):
        turns=scene['dialogue_translations'][code];gap=.30;budget=limit-gap*(len(turns)-1)
        if budget<=0:raise ValueError('Dialogue gaps leave no room for speech.')
        files=[];durations=[]
        for turn in turns:
            voice=speaker_voices[code][turn['speaker']];digest=hashlib.sha256(json.dumps([profile,voice,turn['line']]).encode()).hexdigest()[:20]
            audio=V.synthesize(profile['provider'],voice,turn['line'],work/(digest+'.wav'),**({'language':code} if profile['provider']=='google' else {}));files.append(audio);durations.append(V.audio_duration(audio))
        if sum(durations)>budget*1.30 and profile['provider']=='google':
            import google_tts as G
            total=sum(durations)
            for i,(turn,audio) in enumerate(zip(turns,files)):
                files[i],durations[i]=G.recover_timing(speaker_voices[code][turn['speaker']],turn['line'],audio,budget*durations[i]/total,language=code,max_rate=1.30)
        rate=max(1.,sum(durations)/budget)
        if rate>1.30:raise ValueError('Dialogue still exceeds scene duration; no speech or speaker gap was cut.')
        output=work/(hashlib.sha256(json.dumps(turns,sort_keys=True).encode()).hexdigest()[:20]+'.dialogue.wav')
        args=['ffmpeg','-v','error','-y'];filters=[];pieces=[]
        for i,audio in enumerate(files):
            args+=['-i',audio];filters.append(f'[{i}:a]aresample=48000,aformat=channel_layouts=mono,atempo={rate:.10f}[v{i}]');pieces.append(f'[v{i}]')
            if i<len(files)-1:filters.append(f'anullsrc=r=48000:cl=mono,atrim=duration=0.30[g{i}]');pieces.append(f'[g{i}]')
        filters.append(''.join(pieces)+f'concat=n={len(pieces)}:v=0:a=1[out]');E.run(args+['-filter_complex',';'.join(filters),'-map','[out]',output])
        return output,V.audio_duration(output),' '.join(t['line'] for t in turns)
    text=scene['narration_translations'][code];digest=hashlib.sha256(json.dumps([profile,text]).encode()).hexdigest()[:20]
    audio=V.synthesize(profile['provider'],profile['voice'],text,work/(digest+'.wav'),**({'language':code} if profile['provider']=='google' else {}));actual=V.audio_duration(audio)
    if actual>limit*M.MAX_LANGUAGE_SPEED and profile['provider']=='google':
        import google_tts as G
        audio,actual=G.recover_timing(profile['voice'],text,audio,limit,language=code,max_rate=M.MAX_LANGUAGE_SPEED)
    audio,actual=M.fit(audio,limit,work/(digest+'.fitted.wav'))
    return audio,actual,text


def run(body):
    planned=plan(body);outputs=[];failures=[]
    # Validate all jobs and missing supplied scripts before generating any narration.
    for job in planned['jobs']:
      try:
        print('LOCAL DUBBING STORY: '+job['title'],flush=True)
        original=Path(job['original_story']);work=original.parent/'local_dubbing'/job['key'];work.mkdir(parents=True,exist_ok=True)
        if job['clean_background']:background=Path(job['video']);print('LOCAL DUBBING: using existing clean Audio First background; no speech separation needed.',flush=True)
        else:
            from speech_background import prepare_background
            background=prepare_background(job['video'],original.parent/'local_dubbing/separation',body.get('separation_python',''))
        for profile in planned['multilingual']['languages']:
            code=profile['code'];lang=work/code;lang.mkdir(exist_ok=True);source=job['supplied'];package=copy.deepcopy(source)
            package.update(audio_first=True,narrated=False,original_story=str(original),local_dubbing=dict(keep_background_gain=True,source=job['video'],no_english_generation=True),multilingual_translation_mode='supplied_only');package.pop('multilingual',None)
            audit=[]
            for i,(scene,(start,end)) in enumerate(zip(package['scenes'],job['timeline']),1):
                limit=min(9.8 if end-start>=9.95 else end-start-.15,end-start-.15)
                audio,seconds,text=scene_audio(scene,profile,code,lang,limit,job['speaker_voices'])
                if seconds>limit+.03:raise ValueError(f'{code} scene {i}: narration does not fit; no speech was cut.')
                scene.update(external_narration=text,audio_first_file=str(Path(audio).resolve()),audio_first_duration=seconds,script_line='',dialogue=[])
                audit.append(dict(scene=i,start=start,end=end,seconds=seconds,text=text,audio=str(audio)))
                M.atomic(lang/'NARRATION_REVIEW.json',audit);print(f'LOCAL DUBBING {code} scene {i}/{len(package["scenes"])}: {seconds:.2f}s ready.',flush=True)
            title=safe_story_title(job['title']);raw=lang/(title+' raw.mp4');link(background,raw);storyfile=lang/'localized_story.json';M.atomic(storyfile,package)
            report=lang/'JOINED_CLIP_ORDER.txt';lines=['Completed video: '+str(raw.resolve())]
            lines += [f'{i} | {start:.6f}s | scene {i}' for i,(start,end) in enumerate(job['timeline'],1)]
            end=job['timeline'][-1][1]
            if job['duration']-end>.1:lines.append(f'{len(job["timeline"])+1} | {end:.6f}s | preserved source tail (thumbnail end card)')
            report_text='\n'.join(lines)+'\n'
            if not report.is_file() or report.read_text(encoding='utf-8')!=report_text:report.write_text(report_text,encoding='utf-8')
            for image in original.parent.glob(title+'.*'):
                if image.suffix.lower() in ('.jpg','.jpeg','.png','.webp'):shutil.copy2(image,lang/('thumbnail_downloaded'+image.suffix))
            cfg=E.settings(body.get('editingSettings'));cfg.update(silence_removal_enabled=False,audio_first_trim_gaps=False,preset_cta_enabled=False,caption_language=M.LANGUAGES[code].lower() if code in ('ru','ar','hi','ur','ja') else 'auto')
            # Raw source gets finishing once; explicit/final sources already contain effects.
            if Path(job['video']).resolve()==Path(job['english_video']).resolve():
                cfg.update(editing_camera_enabled=False,editing_transitions_enabled=False,transition_sfx_enabled=False,editing_speed=1.)
                for key in cfg:
                    if key.startswith('camera_effect_') and isinstance(cfg[key],bool):cfg[key]=False
            output=original.parent/(title+' '+M.LANGUAGES[code]+'.mp4')
            final=E.edit(raw,cfg,report,output);outputs.append(str(final));M.atomic(lang/'completed.json',dict(output=str(final),profile=profile))
        M.atomic(work/'LOCAL_DUBBING_COMPLETE.json',dict(outputs=outputs,source=job['video'],english_untouched=True))
      except Exception as exc:
        failures.append(dict(title=job['title'],error=str(exc),transient=isinstance(exc,M.HeyGenNetworkError)));print('LOCAL DUBBING STORY FAILED: '+job['title']+': '+str(exc),flush=True)
    M.atomic(Path(planned['folder'])/'LOCAL_DUBBING_RESULTS.json',dict(outputs=outputs,failed=failures))
    if failures and all(x['transient'] for x in failures):raise M.HeyGenNetworkError('Local narration connection failure; completed separation, audio and outputs cached. Retry resumes unchanged content.')
    if failures:raise ValueError(f'{len(failures)} local dubbing story/stories failed; completed outputs retained. See LOCAL_DUBBING_RESULTS.json.')
    print('LOCAL_DUBBING_OUTPUTS: '+json.dumps(outputs,ensure_ascii=False),flush=True);return outputs

if __name__=='__main__':
    try:run(read(sys.argv[1]))
    except M.HeyGenNetworkError as exc:print('LOCAL DUBBING TRANSIENT NETWORK FAILURE: '+str(exc),flush=True);sys.exit(1)
    except Exception as exc:print('RECOVERY_REVIEW_REQUIRED: LOCAL DUBBING FAILED: '+str(exc),flush=True);sys.exit(2)
