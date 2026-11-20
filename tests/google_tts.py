import base64,io,json,tempfile,sys
from pathlib import Path
from unittest.mock import patch,MagicMock
from threading import Event
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import google_tts as G
import voiceover as V
import video_editing as E
import multilingual as M
import voice_calibration as C
import full_voiceover as F
assert len(G.voices())==30 and any(v['voice_id']=='Alnilam' for v in G.voices())
assert E.settings({'voiceover_provider':'google','voiceover_saved_voices':{'google':'Alnilam'}})['voiceover_provider']=='google'
assert C.model('google')==G.MODEL
assert M.configuration({'enabled':True,'languages':[{'code':'ur','provider':'google','voice':'Alnilam'}]})['languages'][0]['provider']=='google'
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);cfg=root/'service.json';cfg.write_text(json.dumps({'type':'service_account','project_id':'test-project','client_email':'test@example','private_key':'private','token_uri':'https://oauth2.googleapis.com/token'}))
 with patch.object(G,'STORE',root/'store'):
  G.configure(str(cfg));assert G.configure()==str(cfg.resolve())
  assert 'private_key' not in (G.STORE/'config.json').read_text()
  import google.oauth2.service_account as SA
  import google.auth.transport.requests as TR
  creds=MagicMock();creds.token='test-token';creds.valid=True;calls=[]
  auth_release=Event()
  def refresh(request):
   if creds.refresh.call_count>1:
    auth_release.wait(2)
  creds.refresh.side_effect=refresh
  def opened(req,**kw):
   calls.append(req);return io.BytesIO(json.dumps({'audioContent':base64.b64encode(b'RIFFmock').decode()}).encode())
  def convert(command):Path(command[-1]).write_bytes(b'converted')
  with patch.object(SA.Credentials,'from_service_account_info',return_value=creds),patch.object(TR,'Request'),patch.object(G.urllib.request,'urlopen',side_effect=opened),patch.object(E,'run',side_effect=convert),patch.object(V,'audio_duration',return_value=2.):
   with patch.object(G,'AUTH_TIMEOUT',.1):
    try:
     G.synthesize('Orus','First scene',root/'first.wav','ur')
     G.synthesize('Orus','Next scene',root/'next.wav','ja')
     creds.refresh.assert_called_once()
    finally:
     auth_release.set()
   creds.valid=False
   creds.refresh.side_effect=lambda request: setattr(creds,'valid',True)
   G.synthesize('Orus','Expired token',root/'expired.wav','ur')
   assert creds.refresh.call_count==2
   account=json.loads(cfg.read_text())
   account['private_key']='rotated-test-key'
   cfg.write_text(json.dumps(account))
   G.synthesize('Orus','Rotated key',root/'rotated.wav','ja')
   assert creds.refresh.call_count==3
   for code,locale in [('en','en-US'),('ru','ru-RU'),('ar','ar-EG'),('ur','ur-PK'),('hi','hi-IN'),('ja','ja-JP')]:
    file=root/(code+'.mp3');V.synthesize('google','Alnilam','Test text',file,language=code)
    payload=json.loads(calls[-1].data);assert payload['voice']['languageCode']==locale and payload['voice']['name']=='Alnilam' and payload['voice']['modelName']==G.MODEL
    before=len(calls);V.synthesize('google','Alnilam','Test text',file,language=code);assert len(calls)==before
   V.synthesize('google','Orus','Approved words only',root/'directed.mp3',language='en',delivery='Warm story telling; controlled urgency for this beat.')
   directed=json.loads(calls[-1].data)
   assert directed['input']['text']=='Approved words only'
   assert 'controlled urgency' in directed['input']['prompt']
   assert directed['voice']['name']=='Orus' and directed['audioConfig']['speakingRate']==1.0
   assert calls[0].full_url=='https://texttospeech.googleapis.com/v1/text:synthesize'
   release=Event()
   def stalled(*args,**kwargs):
    release.wait()
    return opened(*args,**kwargs)
   try:
    with patch.object(G,'SYNTHESIS_TIMEOUT',.05),patch.object(G.urllib.request,'urlopen',side_effect=stalled):
     target=root/'stall.wav'
     try: G.synthesize('Alnilam','Test text',target,language='en')
     except G.HeyGenNetworkError as error:assert 'exceeded' in str(error)
     else:raise AssertionError('A stuck network read must reach the total deadline')
     assert not target.exists()
   finally:release.set()
   def rejected(message):
    body=json.dumps({'error':{'code':400,'message':message,'status':'INVALID_ARGUMENT'}}).encode()
    return G.urllib.error.HTTPError(calls[0].full_url,400,'Bad Request',None,io.BytesIO(body))
   japanese=dict(provider='google',voice='Alnilam')
   success=io.BytesIO(json.dumps({'audioContent':base64.b64encode(b'RIFFmock').decode()}).encode())
   with patch.object(G.urllib.request,'urlopen',side_effect=[rejected('Request contains an invalid argument.'),success]) as endpoint:
    target=root/'full-ja.mp3'
    assert F.synthesize_full_track(japanese,['同じ原稿を読みます。'],target,'ja','Japanese')==target
    assert endpoint.call_count==2 and endpoint.call_args_list[0].args[0].data==endpoint.call_args_list[1].args[0].data
   with patch.object(G.urllib.request,'urlopen',side_effect=rejected('Unknown voice name.')) as endpoint:
    try:F.synthesize_full_track(japanese,['同じ原稿を読みます。'],root/'bad-ja.mp3','ja','Japanese')
    except ValueError:pass
    else:raise AssertionError('Specific invalid settings must still surface an error')
    assert endpoint.call_count==1
print('PASS: 30 Google voices, service-account-only config, explicit language routing, model, conversion, provider settings, cached retries; no real API requests.')
