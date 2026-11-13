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
  assert len(calls)==2 and seconds==20
print('PASS: Google timing recovery preserves every word and original recording; stops after success or two attempts; correct language; no actual API calls.')

import multilingual as M,video_editing as E
with tempfile.TemporaryDirectory() as tmp:
 p=Path(tmp)/'short.wav';E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=duration=8.56',p])
 audio,duration=M.fit(p,9.8,Path(tmp)/'fit.wav')
 assert 9.60<=duration<=9.80 and p.exists()
print('PASS: modest pitch-preserving slowdown fills an 8.56s line to approximately 9.65s; no speech cut or silence appended.')
