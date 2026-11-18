"""Isolated full-track-first workflow. Never speeds narration to fit visual clips."""
from pathlib import Path
import copy,difflib,hashlib,json,math,re,shutil,sys,tempfile,unicodedata,wave
import video_editing as E
import voiceover as V

def plan_package(body):
    source=Path(body['story']).resolve()
    original=json.loads(source.read_text(encoding='utf-8-sig'))
    if original.get('audio_first') or original.get('narrated') is False or original.get('narration_scope')=='dialogue':
        raise ValueError('Full Voiceover First needs an original narrated story, not dialogue or an already prepared package.')
    lines=[str(s.get('script_line') or '').strip() for s in original.get('scenes',[])]
    if not lines or not all(lines):raise ValueError('Every source visual beat needs English narration.')
    cfg=E.settings(body.get('editingSettings'))
    import narration_delivery
    cfg['_narration_delivery']=narration_delivery.profile(original)
    cfg['_narration_pace_policy']='paragraph_v1'
    if cfg['voiceover_mode'] not in ('api','local'):raise ValueError('Choose API narration or a full local recording in Audio settings.')
    if cfg['voiceover_mode']=='api' and not cfg['voiceover_voice']:raise ValueError('Choose a narration voice first.')
    if cfg['voiceover_mode']=='local' and not Path(cfg['voiceover_file']).is_file():raise ValueError('Choose an existing full narration WAV/MP3.')
    import multilingual
    multi=multilingual.configuration(body.get('multilingual'))
    deferred=body.get('defer_dubbing') is True
    if not deferred and multi['enabled'] and original.get('multilingual_translation_mode')=='supplied_only':
        for profile in multi['languages']:
            if any(not str(s.get('narration_translations',{}).get(profile['code'],'')).strip() for s in original['scenes']):
                raise ValueError('Missing supplied '+multilingual.LANGUAGES[profile['code']]+' narration; no automatic translation or speech request made.')
    seconds=int(original.get('scene_seconds') or 10)
    if seconds not in (4,6,8,10):raise ValueError('Choose 4, 6, 8 or 10 second visual clips.')
    text='\n\n'.join(lines)
    if cfg['voiceover_mode']=='api' and cfg['voiceover_provider']=='google' and len(text.encode('utf-8'))>4000:
        raise ValueError('Full Google narration exceeds 4000 UTF-8 bytes. Use one full local recording or a shorter story; nothing was submitted.')
    identity=[V.preparation_settings(cfg),V.signature(cfg),'full_track_v1']
    if multi['enabled']:identity+=['full_multilingual_v1',multi]
    key=hashlib.sha256(source.read_bytes()+json.dumps(identity,sort_keys=True).encode()).hexdigest()[:12]
    language_folder=source.parent/'full_voiceover'/key
    paced=body.get('english_pace')=='source_duration_v1' and cfg['voiceover_mode']=='api' and cfg['voiceover_provider']=='google'
    paced_key=hashlib.sha256((key+':source_duration_v1').encode()).hexdigest()[:12] if paced else key
    previous_english_folder=source.parent/'full_voiceover'/paced_key
    if deferred:paced_key=hashlib.sha256((paced_key+':deferred_dubbing_v1').encode()).hexdigest()[:12]
    folder=source.parent/'full_voiceover'/paced_key
    return dict(source=source,original=original,cfg=cfg,lines=lines,text=text,seconds=seconds,folder=folder,
                file=folder/'full_voiceover_story.json',multilingual={'enabled':False,'languages':[]} if deferred else multi,
                language_folder=language_folder,previous_english_folder=previous_english_folder,
                english_target=len(lines)*seconds if paced else None,deferred=deferred)

RUSSIAN_SMALL_NUMBERS = (
    'ноль один два три четыре пять шесть семь восемь девять десять '
    'одиннадцать двенадцать тринадцать четырнадцать пятнадцать шестнадцать '
    'семнадцать восемнадцать девятнадцать'
).split()
ARABIC_SMALL_NUMBERS = (
    'صفر|واحد|اثنان|ثلاثة|اربعة|خمسة|ستة|سبعة|ثمانية|تسعة|عشرة|احد عشر|اثنا عشر|'
    'ثلاثة عشر|اربعة عشر|خمسة عشر|ستة عشر|سبعة عشر|ثمانية عشر|تسعة عشر'
).split('|')
ARABIC_NUMBER_WORDS = set(' '.join(ARABIC_SMALL_NUMBERS).split())
URDU_NUMBER_WORDS = set('ایک دو تین چار پانچ چھ سات آٹھ نو دس گیارہ بارہ تیرہ چودہ پندرہ سولہ سترہ اٹھارہ انیس بیس'.split())


class NarrationAlignmentError(ValueError):
    pass


def tokens(text, language=None):
    text=unicodedata.normalize('NFKC',text).casefold()
    text=re.sub('[\u0640\u064b-\u065f\u0670]','',text)
    if language=='ru':
        # Whisper may omit the dots on ё and print spoken measurements as digits and units.
        text=text.replace('ё','е')
        text=re.sub(r'(?<![\w.,-])(?:[0-9]|1[0-9])(?!\w|[.,][0-9])',
                    lambda match:RUSSIAN_SMALL_NUMBERS[int(match[0])],text)
        text=re.sub(r'\b(?:см|сантиметр(?:а|ов|у|ом|е|ы|ам|ами|ах)?)\b','сантиметр',text)
    elif language=='ar':
        text=text.translate(str.maketrans('أإآٱى','ااااي'))
        text=re.sub(r'(?<![\w.,-])(?:[1١۱][0-9٠-٩۰-۹]|[0-9٠-٩۰-۹])(?!\w|[.,][0-9٠-٩۰-۹])',
                    lambda match:ARABIC_SMALL_NUMBERS[int(match[0])],text)
    elif language=='ur':
        text=re.sub(r'\bنشو\s*(?:و\s*)?نم[اہ]\b','نشوونما',text)
        text=re.sub(r'\bپیدایش\b','پیدائش',text)
    return re.findall(r"[\u3040-\u30ff\u3400-\u9fff]|[^\W\u3040-\u30ff\u3400-\u9fff]+(?:[’'-][^\W\u3040-\u30ff\u3400-\u9fff]+)*",text)

def match_words(reference,words,language):
    observed=[]
    for word in words:
        for token in tokens(word['word'],language):observed.append((token,float(word['start']),float(word['end'])))
    if language=='ur':
        merged=[]
        for token,start,end in observed:
            if merged and merged[-1][0]=='نشو' and token in ('نما','نمہ') and start-merged[-1][2]<=.18:
                merged[-1]=('نشوونما',merged[-1][1],end)
            else:
                merged.append((token,start,end))
        observed=merged
    observed_tokens=[word[0] for word in observed]
    matcher=difflib.SequenceMatcher(None,reference,observed_tokens,autojunk=False)
    mapping={}
    for a,b,n in matcher.get_matching_blocks():
        for k in range(n):mapping[a+k]=observed[b+k]
    exact=set(mapping)
    if language in ('ar','ur') and len(exact)/max(1,len(reference))>=.70:
        # Use close spellings as timing evidence only inside an already anchored,
        # equal-length run. Never infer a missing word or treat two numbers as equal.
        number_words=ARABIC_NUMBER_WORDS if language=='ar' else URDU_NUMBER_WORDS
        for operation,a,b,c,d in matcher.get_opcodes():
            if operation!='replace' or b-a!=d-c or a-1 not in exact or b not in exact:
                continue
            for i,j in zip(range(a,b),range(c,d)):
                expected,actual=reference[i],observed_tokens[j]
                if expected in number_words or actual in number_words:
                    continue
                if min(len(expected),len(actual))<4 or not (expected.isalpha() and actual.isalpha()):
                    continue
                if difflib.SequenceMatcher(None,expected,actual).ratio()>=.75:
                    mapping[i]=observed[j]
    return mapping,exact,matcher.get_opcodes()


def timed_sections(lines,words,duration,language=None,corroborating_words=()):
    """Map original words to measured timestamps; reject uncertain visual alignment."""
    beats=[tokens(line,language) for line in lines]
    reference=[token for beat in beats for token in beat]
    mapping,exact,_=match_words(reference,words,language)
    for variant in corroborating_words:
        other,other_exact,_=match_words(reference,variant,language)
        # Fill gaps only when both decodes agree on the neighboring anchors and
        # the additional, exactly matched word fits between their timestamps.
        anchors=sorted(exact & other_exact)
        for a,b in zip(anchors,anchors[1:]):
            if b-a>9 or any(abs(mapping[i][1]-other[i][1])>.45 for i in (a,b)):
                continue
            start=mapping[a][1]
            end=mapping[b][1]
            for i in range(a+1,b):
                if i in mapping:
                    start=mapping[i][1]
                    continue
                if i not in other_exact:
                    continue
                following=next((mapping[j][1] for j in range(i+1,b) if j in mapping),end)
                if start<other[i][1]<following:
                    mapping[i]=other[i]
                    start=other[i][1]
    match_rate=len(mapping)/max(1,len(reference))
    if match_rate<.90:
        raise NarrationAlignmentError(f'Full narration transcript ({language or "unspecified language"}) matched {match_rate:.1%} of the script, below 90%. Review the cached recording and timestamps; no visuals were submitted.')
    cuts=[0.];cursor=0
    for index,beat in enumerate(beats):
        stop=cursor+len(beat)
        if language in ('ar','ur') and not any(k in exact for k in range(cursor,min(stop,cursor+4))):
            raise NarrationAlignmentError(f'Cannot verify the beginning of narration beat {index+1} ({language}) in the measured recording.')
        first_word=next((mapping[k] for k in range(cursor,stop) if k in mapping),None)
        if first_word is None:raise NarrationAlignmentError(f'Cannot locate narration beat {index+1} in the measured recording.')
        if index:cuts.append(first_word[1])
        cursor=stop
    cuts.append(duration)
    if any(b<=a for a,b in zip(cuts,cuts[1:])):raise NarrationAlignmentError('Narration timestamps are not ordered.')
    return list(zip(cuts,cuts[1:]))

def visual_scenes(original,sections,words,duration,seconds):
    output=[];count=max(1,math.ceil(duration/seconds))
    for index in range(count):
        start=index*seconds;stop=min(duration,start+seconds)
        overlaps=[(i,max(start,a),min(stop,b)) for i,(a,b) in enumerate(sections) if a<stop and b>start]
        base=copy.deepcopy(original['scenes'][overlaps[0][0]])
        shots=[];characters=[];contexts=[];visual_events=[]
        for i,a,b in overlaps:
            source=original['scenes'][i];contexts.append(source.get('narrative_context',''))
            characters.extend(source.get('characters',[]))
            source_shots=source.get('shots') or [dict(start_seconds=0,end_seconds=seconds,visual=source.get('narrative_context','Show the supplied topic.'))]
            sa,sb=sections[i];old=float(original.get('scene_seconds') or seconds)
            if source.get('effect') not in (None,'','None') or source.get('sound') or source.get('sound_context'):
                visual_events.append(dict(start_seconds=round(a-start,3),end_seconds=round(b-start,3),
                    source_beat=i+1,source_start_seconds=round((a-sa)/(sb-sa)*old,3),source_end_seconds=round((b-sa)/(sb-sa)*old,3),
                    effect=source.get('effect',''),sound=source.get('sound') or source.get('sound_context','')))
            for shot in source_shots:
                left=sa+float(shot['start_seconds'])/old*(sb-sa)
                right=sa+float(shot['end_seconds'])/old*(sb-sa)
                x,y=max(a,left),min(b,right)
                if y>x:shots.append(dict(start_seconds=round(x-start,3),end_seconds=round(y-start,3),visual=shot['visual']))
        if not shots:raise ValueError('Missing visual coverage for full narration timeline.')
        while len(shots)>4:
            shots[-2]['end_seconds']=shots[-1]['end_seconds'];shots[-2]['visual']+=' Then '+shots[-1]['visual'];shots.pop()
        shots[0]['start_seconds']=0;shots[-1]['end_seconds']=seconds
        # Transcription is timing evidence, never a replacement for approved wording.
        narration=' '.join(original['scenes'][i]['script_line'] for i,_,_ in overlaps)
        base.update(script_line='',dialogue=[],external_narration=narration,audio_first_duration=stop-start,
                    narrative_context=' '.join(contexts)+' Continuous camera-led action matching the measured narration; no frozen filler.',
                    shots=shots,characters=list(dict.fromkeys(characters)),_scene_number=index+1,
                    external_visual_events=visual_events,
                    full_voiceover_start=start,full_voiceover_end=stop,
                    sound='Natural ambience and action-matched SFX only; no narration, dialogue, vocals or music.')
        for key in ('veo3_prompt','narration_translations','effect'):base.pop(key,None)
        output.append(base)
    return output

def prepare_translations(p):
    import multilingual as M
    result={}
    folder=p['language_folder'];folder.mkdir(parents=True,exist_ok=True)
    for profile in p['multilingual']['languages']:
        code=profile['code'];file=folder/(code+'_source_lines.json')
        supplied=[str(s.get('narration_translations',{}).get(code,'')).strip() for s in p['original']['scenes']]
        if all(supplied):
            lines=supplied;file.write_text(json.dumps(lines,ensure_ascii=False),encoding='utf-8')
        else:
            translated=M.translation(p['lines'],code,p['seconds'],file)
            if not isinstance(translated,list) or len(translated)!=len(supplied):
                raise ValueError('Incomplete '+code+' full narration script.')
            lines=[approved or generated for approved,generated in zip(supplied,translated)]
        if len(lines)!=len(p['lines']) or not all(isinstance(t,str) and t.strip() for t in lines):raise ValueError('Incomplete '+code+' full narration script.')
        if profile['provider']=='google' and len('\n\n'.join(lines).encode('utf-8'))>4000:
            raise ValueError(code+' full Google narration exceeds 4000 UTF-8 bytes; no speech request made.')
        result[code]=(profile,lines)
    return result

def synthesize_full_track(profile,lines,target,code,label,target_seconds=None,previous_duration=None):
    import google_tts
    text='\n\n'.join(lines)
    def request():
        if target_seconds is not None:
            return google_tts.synthesize(profile['voice'],text,target,language=code,target_seconds=target_seconds,previous_duration=previous_duration,**({'delivery':profile['delivery']} if profile.get('delivery') else {}))
        return V.synthesize(profile['provider'],profile['voice'],text,target,language=code,**({'delivery':profile['delivery']} if profile.get('delivery') else {}))
    try:
        return request()
    except google_tts.GoogleTTSGenericInvalidArgument:
        E.log(f'FULL VOICEOVER FIRST: Google TTS returned a generic 400 for {label}. Retrying this recording once with the same voice and text.')
        try:
            return request()
        except google_tts.GoogleTTSGenericInvalidArgument as error:
            raise google_tts.GoogleTTSGenericInvalidArgument(f'{label} narration was rejected twice by Google TTS. {error}') from error


def fit_verified_silent_tail(audio,duration,maximum):
    """Remove at most two seconds of verified quiet padding, never ending speech."""
    source=Path(audio)
    if not source.is_file() or not 0<duration-maximum<=2.000001:return None
    import subprocess
    start=max(0.,maximum-.5)
    result=subprocess.run(['ffmpeg','-hide_banner','-ss',str(start),'-i',str(source),
        '-af','silencedetect=noise=-55dB:d=0.08','-f','null','-'],capture_output=True,text=True,timeout=30,
        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if result.returncode:return None
    active=None;last_end=None
    for line in result.stderr.splitlines():
        begin=re.search(r'silence_start: ([0-9.]+)',line)
        end=re.search(r'silence_end: ([0-9.]+)',line)
        if begin:active=start+float(begin[1]);last_end=None
        if end:last_end=start+float(end[1])
    # Require a quiet tail through EOF plus 120ms of quiet BEFORE the cap.
    # Padding within encoded MP3 duration is not evidence of quiet by itself.
    if active is None or last_end is None or last_end<duration-.03 or active>maximum-.12:return None
    # A quiet threshold locates the tail, but only zero PCM samples may be removed.
    target=source.with_name(source.stem+f'.silence-fit-exact-{maximum:g}.wav')
    with tempfile.TemporaryDirectory(dir=source.parent) as work:
        decoded=Path(work)/'decoded.wav'
        E.run(['ffmpeg','-v','error','-i',source,'-ar','48000','-ac','1','-c:a','pcm_s16le',decoded])
        with wave.open(str(decoded),'rb') as recording:
            limit=min(recording.getnframes(),math.floor(maximum*recording.getframerate()))
            recording.setpos(limit)
            if any(recording.readframes(recording.getnframes()-limit)):
                return None
            recording.rewind()
            staging=Path(work)/'fit.wav'
            with wave.open(str(staging),'wb') as fitted:
                fitted.setparams(recording.getparams())
                fitted.writeframes(recording.readframes(limit))
        retained=V.audio_duration(staging)
        if retained>maximum or maximum-retained>.02:
            return None
        if not target.is_file() or staging.read_bytes()!=target.read_bytes():
            staging.replace(target)
    target.with_suffix('.json').write_text(json.dumps(dict(original=str(source),original_seconds=duration,
        retained_seconds=retained,removed_silent_seconds=duration-retained,quiet_tail_start=active,
        noise_threshold_db=-55,speech_cut=False,speed=1.0),indent=2),encoding='utf-8')
    E.log(f'FULL VOICEOVER FIRST: removed {duration-retained:.2f}s of verified trailing silence; {retained:.2f}s retained at 1.00x, no speech cut or extra visual clip.')
    return target


def paced_google_english(profile,lines,folder,target_seconds,clip_seconds):
    maximum=target_seconds+clip_seconds
    if not (folder/'full_narration.source.mp3').is_file():
        E.log(f'FULL VOICEOVER FIRST: Requesting English narration with Google at a {target_seconds}s target.')
    first=synthesize_full_track(profile,lines,folder/'full_narration.source.mp3','en','English',target_seconds)
    duration=V.audio_duration(first)
    E.log(f'FULL VOICEOVER FIRST: English pace target {target_seconds}s, measured {duration:.2f}s, limit {maximum}s.')
    fitted=fit_verified_silent_tail(first,duration,maximum)
    if fitted:return fitted
    if duration<=target_seconds+clip_seconds/2:
        return first
    faster_target=max(target_seconds*.80,target_seconds*target_seconds/duration)
    from heygen_audio import HeyGenNetworkError
    try:
        second=synthesize_full_track(profile,lines,folder/'native_pace_retry.mp3','en','English',faster_target,duration)
        measured=V.audio_duration(second)
    except (ValueError,HeyGenNetworkError):
        if duration<=maximum:
            E.log('FULL VOICEOVER FIRST: Keeping the first English recording within the clip limit after a failed pacing retry.')
            return first
        raise
    E.log(f'FULL VOICEOVER FIRST: English native pace retry measured {measured:.2f}s.')
    fitted=fit_verified_silent_tail(second,measured,maximum)
    if fitted:return fitted
    if duration<=maximum and abs(target_seconds-duration)<=abs(target_seconds-measured):
        return first
    if measured<=maximum:
        return second
    best_duration=min(duration,measured)
    recovery_target=max(target_seconds*.75,faster_target*target_seconds/best_duration)
    # A separate cache path lets Studio Retry keep both prior recordings and
    # request this stronger native delivery only once per prepared package.
    recovery=synthesize_full_track(profile,lines,folder/'native_pace_recovery.mp3',
                                   'en','English',recovery_target,best_duration)
    recovered_duration=V.audio_duration(recovery)
    E.log(f'FULL VOICEOVER FIRST: English native pace recovery measured {recovered_duration:.2f}s.')
    fitted=fit_verified_silent_tail(recovery,recovered_duration,maximum)
    if fitted:return fitted
    if recovered_duration<=maximum:
        return recovery
    raise ValueError(f'English narration is {min(best_duration,recovered_duration):.2f}s after pacing attempts. Maximum is {maximum}s ({int(maximum/clip_seconds)} visual clips). Review voice delivery before generation.')


def record_localized_beats(folder,code,label,profile,lines):
    """Use measured PCM boundaries when the continuous recording cannot be aligned."""
    from multilingual import atomic
    key=hashlib.sha256(json.dumps([code,profile,lines],ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:16]
    work=folder/'per_beat'/key
    work.mkdir(parents=True,exist_ok=True)
    audio=work/'narration.wav';receipt=work/'timing.json'
    if receipt.is_file() and audio.is_file():
        saved=json.loads(receipt.read_text(encoding='utf-8'))
        if saved['sha256']==hashlib.sha256(audio.read_bytes()).hexdigest():
            E.log(f'FULL VOICEOVER FIRST: Reusing timed {label} scene recordings.')
            return saved,[]
    E.log(f'FULL VOICEOVER FIRST: {label} continuous alignment unavailable. Recording {len(lines)} approved beats separately at native speed.')
    sections=[];position=0
    staging=work/'narration.tmp.wav'
    with wave.open(str(staging),'wb') as output:
        output.setparams((1,2,48000,0,'NONE','not compressed'))
        for index,line in enumerate(lines,1):
            beat=work/f'beat_{index:03}.wav'
            try:
                raw=synthesize_full_track(profile,[line],work/f'beat_{index:03}.mp3',code,label)
                if not beat.is_file():
                    converted=beat.with_suffix('.tmp.wav')
                    E.run(['ffmpeg','-v','error','-y','-i',raw,'-ar','48000','-ac','1','-c:a','pcm_s16le',converted])
                    converted.replace(beat)
                with wave.open(str(beat),'rb') as source:
                    count=source.getnframes()
                    if (source.getnchannels(),source.getsampwidth(),source.getframerate())!=(1,2,48000) or count<7200:
                        raise ValueError('Missing or invalid speech audio.')
                    samples=source.readframes(count)
                    if len(samples)!=count*2 or not any(samples):raise ValueError('Empty or incomplete speech audio.')
            except (ValueError,OSError,RuntimeError) as error:
                raise type(error)(f'{label} narration beat {index}: {error}') from error
            output.writeframes(samples)
            sections.append((position/48000,(position+count)/48000));position+=count
    staging.replace(audio)
    track=dict(file=str(audio), seconds=position/48000, sections=sections, lines=lines, profile=profile,
               sha256=hashlib.sha256(audio.read_bytes()).hexdigest(), timing_method='measured_scene_recordings')
    atomic(receipt,track)
    return track,[]


def _record_language_once(folder,cfg,code,profile,lines,local=None,english_target=None,clip_seconds=None):
    folder.mkdir(parents=True,exist_ok=True);audio=folder/'narration.wav'
    import multilingual as M
    label='English' if code=='en' else M.LANGUAGES[code]
    from voiceover_alignment_repair import load_verified_track
    verified=load_verified_track(folder,code,lines)
    if verified:
        audio,duration,sections,words=verified
        if english_target is not None and duration>english_target+clip_seconds:
            raise ValueError('Recovered English narration exceeds the visual clip limit. Review native delivery before generation.')
        E.log(f'FULL VOICEOVER FIRST: Reusing verified {label} recovery timestamps at 1.00x.')
        return dict(file=str(audio),seconds=duration,sections=sections,lines=lines,profile=profile,
                    sha256=hashlib.sha256(audio.read_bytes()).hexdigest()),words
    if code!='en' and not local and (folder/'USE_TIMED_BEATS.json').is_file():
        return record_localized_beats(folder,code,label,profile,lines)
    if local:raw=Path(local)
    elif english_target is not None:raw=paced_google_english(profile,lines,folder,english_target,clip_seconds)
    else:
        target=folder/'full_narration.source.mp3'
        if not target.is_file():E.log(f'FULL VOICEOVER FIRST: Requesting {label} narration with {profile["provider"]}.')
        from google_tts import GoogleTTSGenericInvalidArgument
        try:
            raw=synthesize_full_track(profile,lines,target,code,label)
        except GoogleTTSGenericInvalidArgument:
            if code=='en' or len(lines)<2:
                raise
            M.atomic(folder/'USE_TIMED_BEATS.json',dict(language=code))
            return record_localized_beats(folder,code,label,profile,lines)
    if english_target is not None and raw.suffix=='.wav' and not local:
        audio=raw
    if not audio.is_file():E.run(['ffmpeg','-v','error','-y','-i',raw,'-ar','48000','-ac','1',audio])
    duration=V.audio_duration(audio)
    if not math.isfinite(duration) or duration<=0:raise ValueError('Invalid '+code+' full narration duration.')
    if english_target is not None and duration>english_target+clip_seconds:
        raise ValueError('English narration exceeds the visual clip limit. Review native delivery before generation.')
    E.log(f'FULL VOICEOVER FIRST: {label} {duration:.2f}s, speed 1.00x; measuring source beats locally.')
    settings=dict(cfg,caption_language=label.lower())
    words=E.transcribe(audio,folder,settings)
    try:
        sections=timed_sections(lines,words,duration,language=code)
    except NarrationAlignmentError as first_error:
        try:
            if settings['editing_whisper_model'] not in ('tiny','base'):
                raise first_error
            E.log(f'FULL VOICEOVER FIRST: {label} timing needs a stronger transcript. Retrying the cached recording with Whisper small.')
            words=E.transcribe(audio,folder,dict(settings,editing_whisper_model='small'))
            sections=timed_sections(lines,words,duration,language=code)
        except (NarrationAlignmentError,RuntimeError,OSError):
            if code=='en' or local:
                raise
            M.atomic(folder/'USE_TIMED_BEATS.json',dict(language=code))
            return record_localized_beats(folder,code,label,profile,lines)
    return dict(file=str(audio),seconds=duration,sections=sections,lines=lines,profile=profile,
                sha256=hashlib.sha256(audio.read_bytes()).hexdigest()),words

def record_language(folder,cfg,code,profile,lines,local=None,english_target=None,clip_seconds=None):
    from narration_delivery import pace_audit
    # Cache each candidate independently. Retry never edits the approved text,
    # never accelerates speech, and does not spend video-generation credits.
    for attempt in range(3):
        candidate=folder if attempt==0 else folder/f'consistent_pace_{attempt}'
        directed=dict(profile)
        if attempt:
            directed['delivery']=str(profile.get('delivery',''))+' Maintain approximately 2.9 English words per second in EVERY paragraph. Uniform brisk delivery throughout; no slow opening and no rushed later paragraphs. Preserve all words and the selected voice.'
        track,words=_record_language_once(candidate,cfg,code,directed,lines,local,english_target,clip_seconds)
        audit=pace_audit(lines,track['sections'],code)
        candidate.mkdir(parents=True,exist_ok=True)
        (candidate/'PACE_AUDIT.json').write_text(json.dumps(audit,indent=2),encoding='utf-8')
        track['pace_audit']=audit
        if audit['ok'] or local or profile.get('provider')!='google':
            if audit.get('checked'):E.log(f'FULL VOICEOVER FIRST: {code} speech-aware pace audit passed ({audit.get("method","legacy")}); original recording retained at 1.00x.')
            return track,words
        E.log(f'FULL VOICEOVER FIRST: {code} paragraph pace varies beyond the shared limit; unchanged-text consistent-delivery attempt {attempt+1}/3. No speech speed adjustment.')
    raise ValueError(f'Full narration ({code}) still has uneven paragraph pacing after 3 recordings. See PACE_AUDIT.json. Original text/audio preserved; no visuals submitted.')


def validate_tracks(story,settings):
    tracks=story.get('full_voiceover_tracks',{})
    for profile in [{'code':'en'},*settings['languages']]:
        code=profile['code'];track=tracks.get(code)
        if not track or (code!='en' and profile!={k:v for k,v in track['profile'].items() if k!='delivery'}):
            raise ValueError(f'{code} full narration was not prepared with the selected voice. Prepare Full Voiceover First with these languages before generating clips.')
        audio=Path(track['file'])
        if not audio.is_file() or hashlib.sha256(audio.read_bytes()).hexdigest()!=track['sha256']:
            raise ValueError(f'{code} full narration is missing or changed. Retry the saved audio preparation.')
    return tracks

def retime_visuals(source,output,info,boundaries,end_card,story):
    """Match shared visual beats to the selected recording without modifying speech."""
    visual_sections=story['full_voiceover_visual_sections']
    spoken_sections=story['full_voiceover_sections']
    visual_end=end_card if end_card is not None else info['duration']
    starts=[0.]+[t for t in boundaries if t<visual_end-.01]
    seconds=float(story['scene_seconds'])
    if len(starts)!=len(story['scenes']) or any(abs(b-a-seconds)>.12 for a,b in zip(starts,starts[1:]+[visual_end])):
        raise ValueError('Full Voiceover First needs verified full-length visual clips before timing can be aligned.')
    if len(visual_sections)!=len(spoken_sections):raise ValueError('Visual and narration beat counts differ.')
    clip_edges=starts+[visual_end]
    def raw_time(value):
        index=min(int(value/seconds),len(starts)-1)
        return clip_edges[index]+(value/seconds-index)*(clip_edges[index+1]-clip_edges[index])

    segments=[(raw_time(a),raw_time(b),x,y) for (a,b),(x,y) in zip(visual_sections,spoken_sections)]
    speech_end=spoken_sections[-1][1]
    tail_start=segments[-1][1]
    tail=min(.30,max(0.,visual_end-tail_start))
    if tail>.05:segments.append((tail_start,tail_start+tail,speech_end,speech_end+tail))
    else:tail=0.
    card_start=speech_end+tail if end_card is not None else None
    if end_card is not None:segments.append((end_card,info['duration'],card_start,card_start+info['duration']-end_card))
    filters=[]
    for i,(a,b,x,y) in enumerate(segments):
        if b<=a or y<=x:raise ValueError('Invalid full narration visual timing.')
        length=y-x;speed=(b-a)/length
        filters.append(f'[0:v]trim=start={a:.9f}:end={b:.9f},setpts=(PTS-STARTPTS)/{speed:.12f}[v{i}]')
        audio_prefix=f'[0:a]atrim=start={a:.9f}:end={b:.9f},asetpts=PTS-STARTPTS,{E.tempo_filters(speed)},apad' if info['audio'] else 'anullsrc=r=48000:cl=stereo'
        filters.append(f'{audio_prefix},atrim=duration={length:.9f}[a{i}]')
    inputs=''.join(f'[v{i}][a{i}]' for i in range(len(segments)))
    filters.append(f'{inputs}concat=n={len(segments)}:v=1:a=1[v][a]')
    E.run(['ffmpeg','-v','error','-y','-i',source,'-filter_complex',';'.join(filters),'-map','[v]','-map','[a]',
           '-c:v','libx264','-preset','veryfast','-crf','19','-c:a','aac','-fps_mode','vfr',output])
    mapped=[]
    for cut in boundaries:
        for a,b,x,y in segments:
            if a-.00001<=cut<=b+.00001:
                mapped.append(x+(y-x)*min(1.,max(0.,(cut-a)/(b-a))))
                break
    return sorted(set(mapped)),card_start

def trim_short_overflow(track,seconds):
    duration=float(track['seconds'])
    end=math.floor(duration/seconds)*seconds
    overflow=duration-end
    if end<=0 or not .001<overflow<=2.000001 or end<=track['sections'][-1][0]:
        return track
    # This opt-in intentionally removes the overflowing speech at the end.
    source=Path(track['file'])
    target=source.with_name(source.stem+f'.trimmed-{end}s.wav')
    if not target.is_file():
        staging=target.with_suffix('.pending.wav')
        E.run(['ffmpeg','-v','error','-y','-i',source,'-t',str(end),'-ar','48000','-ac','1','-c:a','pcm_s16le',staging])
        if abs(V.audio_duration(staging)-end)>.02:
            raise ValueError('Trimmed narration failed duration validation.')
        staging.replace(target)
    result=dict(track,file=str(target),seconds=end,
                sections=[(a,min(b,end)) for a,b in track['sections'] if a<end],
                sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
                trimmed_speech_seconds=overflow,untrimmed_file=str(source))
    E.log(f'FULL VOICEOVER FIRST: selected overflow trim removed {overflow:.2f}s of ending speech; {end:.2f}s retained.')
    return result


def prepare(body):
    p=plan_package(body);folder=p['folder'];folder.mkdir(parents=True,exist_ok=True)
    cfg=p['cfg'];translated=prepare_translations(p)
    english_folder=folder
    previous=p['previous_english_folder']
    if p['deferred'] and (previous/'narration.wav').is_file() and (previous/'full_narration.source.mp3').is_file():
        english_folder=previous
    english,words=record_language(english_folder,cfg,'en',dict(provider=cfg['voiceover_provider'],voice=cfg['voiceover_voice'],delivery=cfg.get('_narration_delivery','')),p['lines'],cfg['voiceover_file'] if cfg['voiceover_mode']=='local' else None,
                                 english_target=p['english_target'],clip_seconds=p['seconds'])
    tracks={'en':english}
    for code,(profile,lines) in translated.items():tracks[code],_=record_language(p['language_folder']/'languages'/code,cfg,code,dict(profile,delivery=cfg.get('_narration_delivery','')),lines)
    if cfg.get('full_voiceover_trim_tail'):
        tracks={code:trim_short_overflow(track,p['seconds']) for code,track in tracks.items()}
        english=tracks['en']
        words=[dict(row,end=min(row['end'],english['seconds']))
               for row in words if row['start']<english['seconds']]
    sections=english['sections'];duration=english['seconds']
    if translated and p['english_target'] is None:
        position=0.;sections=[]
        for i in range(len(p['lines'])):
            longest=max(t['sections'][i][1]-t['sections'][i][0] for t in tracks.values())
            sections.append((position,position+longest));position+=longest
        duration=position
    story=copy.deepcopy(p['original']);scenes=visual_scenes(story,sections,words,duration,p['seconds'])
    story.update(audio_first=True,full_voiceover_first=True,narrated=False,narration_scope='none',flow_voice='',flow_voices=[],
                 scenes=scenes,total_scenes=len(scenes),video_duration=f"{len(scenes)*p['seconds']} seconds",
                 original_story=str(p['source']),full_voiceover_file=english['file'],full_voiceover_seconds=english['seconds'],
                 full_voiceover_sections=english['sections'],audio_first_common_pace=1.0)
    for key in ('zack_ready_import','script_import','multilingual','multilingual_translation_mode'):story.pop(key,None)
    if translated:
        story.update(multilingual=p['multilingual'],full_voiceover_tracks=tracks,full_voiceover_visual_sections=sections)
    if p['deferred']:
        from pending_dubbing import supplied_languages
        story.update(deferred_dubbing=supplied_languages(p['original']),full_voiceover_tracks=tracks,
                     full_voiceover_visual_sections=sections)
    p['file'].write_text(json.dumps(story,ensure_ascii=False,indent=2),encoding='utf-8')
    (folder/'FULL_VOICEOVER_REVIEW.json').write_text(json.dumps(dict(audio=english['file'],seconds=english['seconds'],speed=1.,source_beats=len(sections),visual_clips=len(scenes),clip_seconds=p['seconds'],sections=sections,languages=tracks),indent=2),encoding='utf-8')
    for image in p['source'].parent.iterdir():
        if image.name in ('refs.json','character_sheets.txt'):shutil.copy2(image,folder/image.name)
    E.run(['node',str(E.ROOT/'story_to_agent_prompt.js'),p['file']])
    print(f"FULL_VOICEOVER_STORY: {p['file']}\nFULL VOICEOVER FIRST: {len(scenes)} visual clips; original story untouched; narration has no speed adjustment.",flush=True)
    return p['file']

if __name__=='__main__':
    from heygen_audio import HeyGenNetworkError
    try:prepare(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig')))
    except HeyGenNetworkError as exc:print('FULL VOICEOVER FIRST TRANSIENT NETWORK FAILURE: '+str(exc)+' Cached recordings retained; retry resumes the saved request.',flush=True);sys.exit(1)
    except Exception as exc:print('RECOVERY_REVIEW_REQUIRED: FULL VOICEOVER FIRST FAILED: '+str(exc),flush=True);sys.exit(2)
