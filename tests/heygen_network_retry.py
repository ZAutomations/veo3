import io,json,tempfile,sys,urllib.error
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import heygen_audio as H
import voiceover as V
with patch.object(H,'api_key',return_value='secret'),patch.object(H.urllib.request,'urlopen',side_effect=urllib.error.URLError('WinError 10060 secret')):
 try:H.speech('voice','Hello')
 except H.HeyGenNetworkError as e:assert 'secret' not in str(e)
 else:raise AssertionError('Timeout not transient')
for status,expected in [(429,H.HeyGenNetworkError),(503,H.HeyGenNetworkError),(400,ValueError),(402,ValueError)]:
 with patch.object(H,'api_key',return_value='secret'),patch.object(H.urllib.request,'urlopen',side_effect=urllib.error.HTTPError('https://example',status,'error',{},io.BytesIO(b'bad request'))):
  try:H.speech('voice','Hello')
  except expected:pass
  else:raise AssertionError(status)
with tempfile.TemporaryDirectory() as tmp:
 target=Path(tmp)/'voice.mp3';ids=[]
 def speech(*args,**kw):
  ids.append(kw['idempotency_key'])
  if len(ids)==1:raise H.HeyGenNetworkError('timeout')
  return {'data':{'audio_url':'https://example/audio'}}
 with patch.object(H,'speech',side_effect=speech),patch.object(V.urllib.request,'urlopen',return_value=io.BytesIO(b'audio')):
  try:V.synthesize('heygen','voice','hello',target)
  except H.HeyGenNetworkError:pass
  V.synthesize('heygen','voice','hello',target)
  V.synthesize('heygen','voice','hello',target)
 assert len(ids)==2 and ids[0]==ids[1] and target.read_bytes()==b'audio'
print('PASS: timeouts/429/503 retryable; 400/402 require review; same retry identity retained; completed audio skipped; no real API calls.')
