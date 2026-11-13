import base64,io,json,tempfile,sys
from pathlib import Path
from unittest.mock import patch,MagicMock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import google_tts as G
import voiceover as V
import video_editing as E
import multilingual as M
import voice_calibration as C
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
  creds=MagicMock();creds.token='test-token';calls=[]
  def opened(req,**kw):
   calls.append(req);return io.BytesIO(json.dumps({'audioContent':base64.b64encode(b'RIFFmock').decode()}).encode())
  def convert(command):Path(command[-1]).write_bytes(b'converted')
  with patch.object(SA.Credentials,'from_service_account_info',return_value=creds),patch.object(TR,'Request'),patch.object(G.urllib.request,'urlopen',side_effect=opened),patch.object(E,'run',side_effect=convert),patch.object(V,'audio_duration',return_value=2.):
   for code,locale in [('en','en-US'),('ru','ru-RU'),('ar','ar-EG'),('ur','ur-PK'),('hi','hi-IN'),('ja','ja-JP')]:
    file=root/(code+'.mp3');V.synthesize('google','Alnilam','Test text',file,language=code)
    payload=json.loads(calls[-1].data);assert payload['voice']['languageCode']==locale and payload['voice']['name']=='Alnilam' and payload['voice']['modelName']==G.MODEL
    before=len(calls);V.synthesize('google','Alnilam','Test text',file,language=code);assert len(calls)==before
   assert calls[0].full_url=='https://texttospeech.googleapis.com/v1/text:synthesize'
print('PASS: 30 Google voices, service-account-only config, explicit language routing, model, conversion, provider settings, cached retries; no real API requests.')
