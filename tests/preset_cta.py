"""Real ffmpeg checks for optional CTA lookup, order, fit, audio and repeat safety."""
from pathlib import Path
import json,subprocess,sys,tempfile
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import video_editing as E
import preset_cta as C

def pixel(path,t):
    b=subprocess.check_output(['ffmpeg','-v','error','-ss',str(t),'-i',str(path),'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-'])
    return tuple(b[:3])
def frequency(path,t):
    b=subprocess.check_output(['ffmpeg','-v','error','-ss',str(t),'-i',str(path),'-t','0.2','-vn','-f','f32le','-ac','1','-ar','48000','-'])
    a=np.frombuffer(b,dtype=np.float32);return np.argmax(abs(np.fft.rfft(a)))*48000/len(a)
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);folder=root/'story';folder.mkdir();raw=folder/'Example raw.mp4'
    (folder/'example_story.json').write_text(json.dumps({'preset_id':'cats-behavior-3d'}))
    assert C.find(raw,root) is None
    refs=root/'Preset References'/'cats-behavior-3d';refs.mkdir(parents=True)
    (refs/'wrongCTA.mp4').write_bytes(b'not selected')
    assert C.find(raw,root) is None
    cta=refs/'cats-behavior-3dCTA.mp4'
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=blue:s=160x90:r=24:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='gte(t,1)'",'-c:v','libx264','-c:a','aac',raw])
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=green:s=96x160:r=24:d=0.5','-f','lavfi','-i','sine=frequency=880:duration=0.5','-c:v','libx264','-c:a','aac',cta])
    report=folder/'JOINED_CLIP_ORDER.txt';report.write_text(f'Completed video: {raw}\n01 | 0.00s | scene-01.mp4\n02 | 1.00s | thumbnail.jpg (thumbnail end card)\n')
    assert C.find(raw,root)==cta
    cfg={'editing_camera_enabled':False,'silence_removal_enabled':False,'editing_speed':1.0}
    out=folder/'Example.mp4'
    with patch.object(E,'ROOT',root),patch.object(E,'sync_video_thumbnail',return_value=None):
        E.edit(raw,cfg,report,out)
        info=E.probe(out);assert abs(info['duration']-2.5)<.1 and info['width']==160 and info['height']==90
        blue=pixel(out,.3);green=pixel(out,1.2);red=pixel(out,1.8)
        assert blue[2]>blue[0]+50 and green[1]>green[0]+20 and red[0]>red[2]+50,(blue,green,red)
        assert abs(frequency(out,1.1)-880)<15,'CTA own audio was changed or removed'
        stamp=out.stat().st_mtime_ns;E.edit(raw,cfg,report,out);assert out.stat().st_mtime_ns==stamp,'Repeated render duplicated CTA'
        try:E.edit(out,cfg)
        except ValueError as e:assert 'already contains' in str(e)
        else:raise AssertionError('Finished export must not duplicate CTA')
        disabled=E.edit(raw,{**cfg,'preset_cta_enabled':False,'editing_speed':.95},report,folder/'disabled.mp4')
        assert abs(E.probe(disabled)['duration']-2/.95)<.1
        slow=E.edit(raw,{**cfg,'editing_speed':.95},report,folder/'slow.mp4')
        assert abs(E.probe(slow)['duration']-(2/.95+.5))<.1,'CTA duration must not be sped or slowed with story'
    silent=root/'silent_cta.mp4'
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=green:s=96x160:r=24:d=0.5','-c:v','libx264',silent])
    ending=folder/'no_thumbnail.mp4';C.append(raw,silent,ending,folder,0)
    assert abs(E.probe(ending)['duration']-2.5)<.1 and E.probe(ending)['audio']
    green=pixel(ending,2.2);assert green[1]>green[0]+20,'No-thumbnail render must end with CTA'
    (folder/'example_story.json').write_text(json.dumps({'preset_id':'3d-zack-style'}))
    assert C.find(raw,root) is None,'Never use another presets CTA'
print('PASS: optional per-preset CTA lookup, story/CTA/thumbnail frame order, aspect fit, CTA audio/speed, disabled/missing behavior and no duplicate append. No live API calls.')
