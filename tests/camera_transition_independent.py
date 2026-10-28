import sys,tempfile,pathlib
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import video_editing as e
from moviepy import VideoFileClip
with tempfile.TemporaryDirectory() as tmp:
    folder=pathlib.Path(tmp);source=folder/'already_joined.mp4'
    e.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=red:s=180x320:r=24:d=1',
        '-f','lavfi','-i','color=blue:s=180x320:r=24:d=1','-f','lavfi','-i','sine=frequency=440:duration=2',
        '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a',
        '-c:v','libx264','-preset','ultrafast','-c:a','aac',source])
    original=source.read_bytes();report=folder/'JOINED_CLIP_ORDER.txt'
    report.write_text(f'Completed video: {source}\n01 | 0.00s | one.mp4\n02 | 1.00s | two.mp4\n')
    with patch.object(e,'render_dissolve',side_effect=AssertionError('Dissolve must stay OFF')):
        output=e.edit(source,dict(editing_camera_enabled=True,editing_transitions_enabled=False),report=report)
    info=e.probe(output);assert info['audio'] and abs(info['duration']-2)<.08
    with VideoFileClip(str(output)) as clip:
        frame=clip.get_frame(1.16)
        assert frame[:,:40,0].mean()>150 and frame[:,-40:,2].mean()>150
        assert clip.get_frame(1.7)[:,:,2].mean()>200
    assert source.read_bytes()==original
    assert pathlib.Path(e.edit(source,dict(editing_camera_enabled=False,editing_transitions_enabled=False))).resolve()==source.resolve()
print('PASS: existing joined video gets visible camera swipe with Dissolve OFF; audio/duration/source preserved; both OFF is a no-op.')
