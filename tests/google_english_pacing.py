import sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import audio_first as A,video_editing as E
with tempfile.TemporaryDirectory() as tmp:
 audios=[]
 for i,seconds in enumerate([9.56,11.48,12.12,9.08,11.68,9.44]):
  p=Path(tmp)/f'scene_{i}.wav';E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'sine=duration={seconds}',p]);audios.append(p)
 fitted,rates=A.fit_google_story(audios,10)
 assert len(fitted)==6 and all(9.40<=d<=9.51 for p,d in fitted)
 assert min(rates)<1 and max(rates)<=1.30
 assert audios[0].exists()
print('PASS: six different Google source durations all fill approximately 9.5s; short lines are not accelerated by longest-line tempo; originals retained.')
