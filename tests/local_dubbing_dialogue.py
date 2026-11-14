from pathlib import Path
import sys,tempfile,shutil
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import local_dubbing as L,video_editing as E,voiceover as V
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);tone=root/'tone.wav';E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=duration=1','-ar','48000',tone]);calls=[]
 def synth(provider,voice,text,target,**kw):calls.append((voice,kw['language']));shutil.copy2(tone,target);return Path(target)
 scene={'dialogue_translations':{'ur':[{'speaker':'Wolf','line':'ایک بات'},{'speaker':'Bear','line':'دوسری بات'}]}}
 with patch.object(V,'synthesize',side_effect=synth):
  out,seconds,text=L.scene_audio(scene,{'provider':'google','voice':'Alnilam'},'ur',root,3.85,{'ur':{'Wolf':'Alnilam','Bear':'Orus'}})
 assert calls==[('Alnilam','ur'),('Orus','ur')] and 2.27<seconds<2.34
print('PASS: dialogue uses distinct selected voices in order and retains the full 0.30-second speaker gap.')
