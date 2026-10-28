import sys,tempfile,pathlib
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import video_editing as e
from moviepy import VideoFileClip
with tempfile.TemporaryDirectory() as tmp:
    folder=pathlib.Path(tmp);source=folder/'joined.mp4';out=folder/'dissolve.mp4'
    e.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=red:s=180x320:r=24:d=1',
        '-f','lavfi','-i','color=blue:s=180x320:r=24:d=1',
        '-f','lavfi','-i','sine=frequency=440:duration=2',
        '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a',
        '-c:v','libx264','-preset','ultrafast','-c:a','aac',source])
    e.render_dissolve(source,out,[1])
    a=e.probe(source);b=e.probe(out);assert abs(a['duration']-b['duration'])<.08 and b['audio']
    with VideoFileClip(str(out)) as video:
        frame=video.get_frame(1.15).mean(axis=(0,1));assert frame[0]>50 and frame[2]>50,frame
        end=video.get_frame(1.6).mean(axis=(0,1));assert end[2]>200 and end[0]<20,end
print('PASS: dissolve blends actual outgoing/incoming frames, preserves duration/audio, and returns to clean incoming video.')
