import sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import audio_first as A,video_editing as E
with tempfile.TemporaryDirectory() as tmp:
 audios=[]
 for i,seconds in enumerate([9.56,9.80,10.12,9.08,9.68,9.44]):
  p=Path(tmp)/f'scene_{i}.wav';E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'sine=duration={seconds}',p]);audios.append(p)
 fitted,rates=A.fit_google_story(audios,10)
 assert len(fitted)==6 and all(9.62<=d<=9.73 for p,d in fitted)
 assert min(rates)<1 and max(rates)<=1.05
 assert audios[0].exists()
 slow=Path(tmp)/'slow.wav';E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=duration=12',slow])
 try:A.fit_google_story([slow],10)
 except ValueError as exc:assert 'no speech was cut' in str(exc)
 else:raise AssertionError('A 27% speed-up must not be allowed for English.')
print('PASS: 10.12s delivery fits within 5% speed and a 0.30s end margin; excessive speed rejected; original files retained.')
