import sys,tempfile,pathlib,subprocess,json
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import video_editing as e
for value in [.15,.25,.5,1,1.1,1.15,1.25,1.35,2]:assert e.settings(dict(editing_speed=value))['editing_speed']==value
for value in [0,.1,2.1,float('nan'),True]:
    try:e.settings(dict(editing_speed=value))
    except ValueError:pass
    else:raise AssertionError(value)
with tempfile.TemporaryDirectory() as tmp:
    folder=pathlib.Path(tmp);source=folder/'combined.mp4'
    e.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=s=180x320:r=24:d=2',
        '-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-preset','ultrafast','-c:a','aac',source])
    original=source.read_bytes()
    for speed in [.15,.5,1.25,2]:
        output=folder/f'speed_{speed}.mp4';e.edit(source,dict(editing_speed=speed),output=output)
        info=e.probe(output);assert abs(info['duration']-2/speed)<.2,info
        raw=subprocess.run(['ffmpeg','-v','error','-i',str(output),'-f','f32le','-ac','1','-ar','16000','-'],capture_output=True,check=True).stdout
        samples=np.frombuffer(raw,dtype=np.float32);part=samples[int(len(samples)*.25):int(len(samples)*.75)]
        spectrum=np.abs(np.fft.rfft(part));peak=np.fft.rfftfreq(len(part),1/16000)[spectrum.argmax()]
        assert abs(peak-440)<10,(speed,peak)
    seen=[];actual=e.apply_speed
    def track(src,out,speed):seen.append(pathlib.Path(src).name);return actual(src,out,speed)
    with patch.object(e,'transcribe',return_value=[dict(word='Hello',start=.1,end=.8),dict(word='world',start=.8,end=1.5)]),patch.object(e,'apply_speed',side_effect=track):
        e.edit(source,dict(editing_speed=1.35,clipper_captions_enabled=True,clipper_caption_preset='frameloom_bold_pop'),output=folder/'caption_speed.mp4')
    assert seen==['captioned.mp4'],seen
    assert source.read_bytes()==original
    assert pathlib.Path(e.edit(source,dict(editing_speed=1))).resolve()==source.resolve()
print('PASS: speed 0.15–2 validation, slow/fast duration, pitch retained near 440Hz, captions rendered before speed, originals preserved and 1x no-op.')
