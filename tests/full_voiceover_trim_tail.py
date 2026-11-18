from pathlib import Path
from unittest.mock import patch
import sys,tempfile,hashlib
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import full_voiceover as F
import video_editing as E
with tempfile.TemporaryDirectory() as temp:
 p=Path(temp)/'narration.wav'
 E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=12','-ac','1',p])
 initial=p.read_bytes()
 track=dict(file=str(p),seconds=12,sections=[(0,12)],sha256=hashlib.sha256(initial).hexdigest())
 result=F.trim_short_overflow(track,10)
 assert result['seconds']==10 and result['sections']==[(0,10)]
 assert abs(F.V.audio_duration(result['file'])-10)<.02
 assert p.read_bytes()==initial
 assert F.trim_short_overflow(dict(track,seconds=12.01),10)['file']==str(p)
 assert F.trim_short_overflow(dict(track,seconds=10),10)['file']==str(p)
 assert E.defaults()['full_voiceover_trim_tail'] is False
print('PASS: opt-in trims two-second overflow, preserves source, leaves longer overflow for extra clips.')
