import sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import google_tts as G,voiceover as V
with tempfile.TemporaryDirectory() as tmp:
 p=Path(tmp)/'original.mp3';p.write_bytes(b'original');calls=[]
 def synth(voice,text,file,**kw):
  calls.append((voice,text,kw));Path(file).write_bytes(b'paced');return file
 def duration(file):return 15 if Path(file)==p else 9.6
 with patch.object(G,'synthesize',side_effect=synth),patch.object(V,'audio_duration',side_effect=duration):
  audio,seconds=G.recover_timing('Alnilam','Preserve every word.',p,9.8,language='ru')
  assert seconds==9.6 and len(calls)==1 and calls[0][1]=='Preserve every word.' and calls[0][2]['language']=='ru'
  assert p.read_bytes()==b'original'
 calls.clear()
 with patch.object(G,'synthesize',side_effect=synth),patch.object(V,'audio_duration',return_value=20):
  audio,seconds=G.recover_timing('Alnilam','Unchanged.',p,9.8,language='ar')
  assert len(calls)==G.MAX_PACING_ATTEMPTS and seconds==20
 calls.clear()
 stale=p.with_name(p.stem+'.paced-v1-2'+p.suffix);stale.write_bytes(b'old slow retry')
 def adaptive_duration(file):
  name=Path(file).name
  return 16.8 if Path(file)==p else (13.36 if '.paced-v1-1' in name else 11.5)
 with patch.object(G,'synthesize',side_effect=synth),patch.object(V,'audio_duration',side_effect=adaptive_duration):
  audio,seconds=G.recover_timing('Orus','Every original word stays.',p,9.48,language='en')
  assert seconds==11.5 and len(calls)==2
  assert calls[1][2]['target_seconds']<calls[0][2]['target_seconds']
  assert '.paced-v2-2-' in audio.name and audio!=stale
  assert all(c[1]=='Every original word stays.' for c in calls)
  assert stale.read_bytes()==b'old slow retry'
 calls.clear()
 def third_attempt(file):
  name=Path(file).name
  return 16.8 if Path(file)==p else (11.5 if '.paced-v2-3-' in name else 13.2)
 with patch.object(G,'synthesize',side_effect=synth),patch.object(V,'audio_duration',side_effect=third_attempt):
  audio,seconds=G.recover_timing('Orus','Keep the exact sentence.',p,9.48,language='en')
  assert seconds==11.5 and len(calls)==3
  assert calls[2][2]['target_seconds']<=calls[1][2]['target_seconds']
  assert all(c[1]=='Keep the exact sentence.' for c in calls)
print('PASS: automatic progressive timing retries stop on success or four attempts; exact words, original recording and language retained; no actual API calls.')

import multilingual as M,video_editing as E
with tempfile.TemporaryDirectory() as tmp:
 p=Path(tmp)/'short.wav';E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=duration=8.56',p])
 audio,duration=M.fit(p,9.8,Path(tmp)/'fit.wav')
 assert 9.60<=duration<=9.80 and p.exists()
print('PASS: modest pitch-preserving slowdown fills an 8.56s line to approximately 9.65s; no speech cut or silence appended.')
