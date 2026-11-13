"""Optional Gemini Cloud TTS using a service account; no Developer API fallback."""
import base64,json,os,re,subprocess,tempfile,urllib.request,urllib.error
from pathlib import Path
from heygen_audio import HeyGenNetworkError
MODEL='gemini-3.1-flash-tts-preview'
VOICE_NAMES='Achernar Achird Algenib Algieba Alnilam Aoede Autonoe Callirrhoe Charon Despina Enceladus Erinome Fenrir Gacrux Iapetus Kore Laomedeia Leda Orus Puck Pulcherrima Rasalgethi Sadachbia Sadaltager Schedar Sulafat Umbriel Vindemiatrix Zephyr Zubenelgenubi'.split()
LANGUAGES={'en':'en-US','ru':'ru-RU','ar':'ar-EG','hi':'hi-IN','ur':'ur-PK','es':'es-ES','fr':'fr-FR','de':'de-DE','ja':'ja-JP'}
STORE=Path(os.environ.get('LOCALAPPDATA',Path.home()))/'Veo3Studio'/'google_tts'

def configure(path=''):
    STORE.mkdir(parents=True,exist_ok=True)
    if path:
        file=Path(path).expanduser().resolve()
        data=json.loads(file.read_text(encoding='utf-8-sig'))
        if data.get('type')!='service_account' or not all(data.get(k) for k in ('project_id','client_email','private_key','token_uri')):raise ValueError('Choose a valid Google service-account JSON.')
        if data['token_uri']!='https://oauth2.googleapis.com/token':raise ValueError('Unsupported OAuth token endpoint.')
        tmp=STORE/'config.tmp';tmp.write_text(json.dumps({'service_account':str(file)}),encoding='utf-8');tmp.replace(STORE/'config.json')
    return service_account()

def service_account():
    try:file=Path(json.loads((STORE/'config.json').read_text(encoding='utf-8'))['service_account'])
    except (OSError,ValueError,KeyError):raise ValueError('Browse and save your Google service-account JSON first.') from None
    if not file.is_file():raise ValueError('Saved Google service-account file is missing; browse to it again.')
    return str(file)

def voices():return [{'voice_id':v,'name':v} for v in VOICE_NAMES]

def language_for(text):
    if re.search('[\u0400-\u04ff]',text):return 'ru'
    if re.search('[\u0900-\u097f]',text):return 'hi'
    if re.search('[\u3040-\u30ff\u4e00-\u9fff]',text):return 'ja'
    if re.search('[\u0679\u0688\u0691\u06ba\u06be\u06c1\u06d2]',text):return 'ur'
    if re.search('[\u0600-\u06ff]',text):return 'ar'
    return 'en'

def synthesize(voice,text,target,language=None,target_seconds=None,previous_duration=None):
    target=Path(target)
    if target.is_file() and target.stat().st_size:return target
    if voice not in VOICE_NAMES:raise ValueError('Choose a supported Google voice.')
    if not text.strip() or len(text.encode('utf-8'))>4000:raise ValueError('Google scene narration must contain 1–4000 UTF-8 bytes; no speech was truncated.')
    code=language or language_for(text)
    if code not in LANGUAGES:raise ValueError('Unsupported Google narration language.')
    try:
        from google.oauth2.service_account import Credentials
        from google.auth.transport.requests import Request
    except ImportError:raise ValueError('Google TTS needs google-auth[requests]; rerun setup to install updated editing requirements.') from None
    file=service_account();data=json.loads(Path(file).read_text(encoding='utf-8-sig'))
    try:
        credentials=Credentials.from_service_account_info(data,scopes=['https://www.googleapis.com/auth/cloud-platform'])
        credentials.refresh(Request())
    except Exception as exc:
        from google.auth.exceptions import TransportError
        if isinstance(exc,TransportError):raise HeyGenNetworkError('Google authentication connection failed; saved narration preserved.') from None
        raise ValueError('Google service-account authentication failed; verify the account/key is active.') from None
    direction='Read only the supplied narration naturally and clearly. Keep one consistent narrator voice. Do not add words.'
    if target_seconds is not None:
        if not 0 < float(target_seconds) <= 60:raise ValueError('Invalid narration duration target.')
        direction += f' Deliver the entire text in approximately {float(target_seconds):.2f} seconds at a brisk, fluent explainer pace. Use minimal phrase pauses, no dramatic pauses, no drawn-out syllables and no slow introduction. Preserve every word, number and qualification. Do not say these instructions.'
        if previous_duration:direction += f' The previous delivery took {float(previous_duration):.2f} seconds and was too slow; increase the speaking pace substantially while staying intelligible.'
    payload={'input':{'text':text,'prompt':direction},'voice':{'languageCode':LANGUAGES[code],'modelName':MODEL,'name':voice},'audioConfig':{'audioEncoding':'LINEAR16','speakingRate':1.0}}
    req=urllib.request.Request('https://texttospeech.googleapis.com/v1/text:synthesize',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+credentials.token,'x-goog-user-project':data['project_id']})
    try:
        with urllib.request.urlopen(req,timeout=240) as response:result=json.load(response)
    except urllib.error.HTTPError as exc:
        msg=exc.read().decode(errors='replace')[:1500]
        error=HeyGenNetworkError if exc.code in (408,429,500,502,503,504) else ValueError
        raise error('Google Cloud TTS HTTP '+str(exc.code)+': '+msg) from None
    except OSError:raise HeyGenNetworkError('Google Cloud TTS connection timed out/failed; completed narration preserved.') from None
    audio=base64.b64decode(result.get('audioContent',''),validate=True)
    if not audio:raise ValueError('Google Cloud TTS returned empty audio.')
    import video_editing as E
    target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='veo_google_') as tmp:
        source=Path(tmp)/'source.wav';source.write_bytes(audio)
        converted=target.with_name(target.stem+'.google-tmp'+target.suffix)
        try:
            E.run(['ffmpeg','-v','error','-y','-i',source,'-ar','48000','-ac','1',converted])
            from voiceover import audio_duration
            audio_duration(converted);converted.replace(target)
        finally:converted.unlink(missing_ok=True)
    return target


def recover_timing(voice,text,audio,target_seconds,language=None,max_rate=1.30):
    """Retry unchanged words with explicit delivery direction; preserve original audio."""
    from voiceover import audio_duration
    original=Path(audio);best=original;duration=audio_duration(best)
    history=[]
    for attempt in range(1,3):
        if duration <= target_seconds*max_rate:break
        paced=original.with_name(original.stem+f'.paced-v1-{attempt}'+original.suffix)
        action='reusing cached faster delivery' if paced.is_file() else 'requesting unchanged text with faster delivery'
        print(f'Google narration pacing: {duration:.2f}s exceeds {target_seconds:.2f}s window; {action} ({attempt}/2).',flush=True)
        synthesize(voice,text,paced,language=language,target_seconds=target_seconds-.15,previous_duration=duration)
        measured=audio_duration(paced)
        print(f'Google narration pacing result: {measured:.2f}s; exact text retained, original recording preserved.',flush=True)
        history.append({'attempt':attempt,'audio':str(paced),'seconds':measured,'text_unchanged':True})
        if measured<duration:best=paced;duration=measured
        report=original.with_name(original.stem+'.pacing.json');tmp=report.with_suffix('.tmp')
        tmp.write_text(json.dumps({'original':str(original),'selected':str(best),'target_seconds':target_seconds,'maximum_post_speed':max_rate,'attempts':history},indent=2),encoding='utf-8');tmp.replace(report)
    return best,duration
