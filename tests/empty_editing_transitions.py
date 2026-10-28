import sys,tempfile,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import video_editing as e
with tempfile.TemporaryDirectory() as tmp:
    folder=pathlib.Path(tmp);source=folder/'joined.mp4'
    e.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=blue:s=180x320:r=24:d=2',
        '-f','lavfi','-i','aevalsrc=0.3*sin(2*PI*440*t)*between(t\\,0.4\\,1.6):s=44100:d=2',
        '-c:v','libx264','-preset','ultrafast','-c:a','aac',source])
    original=source.read_bytes()
    cfg=e.settings(dict(editing_transitions_enabled=True,silence_removal_enabled=True,silence_min_duration=.2,silence_padding=.05))
    cfg.update({key:False for key in e.TRANSITIONS})
    output=e.edit(source,cfg)
    assert output.exists() and output!=source and e.probe(output)['audio']
    assert e.probe(output)['duration']<e.probe(source)['duration']
    assert source.read_bytes()==original
print('PASS: empty transition selection skips safely after silence removal, completes edited output and preserves original/audio.')
