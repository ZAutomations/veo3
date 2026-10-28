import json
import pathlib
import sys
import tempfile
import numpy as np

ROOT=pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
import video_editing as e
import video_editing_desktop as preview

assert e.keep_intervals(8,[0],[8],.15)==[]
assert e.keep_intervals(8,[],[],.15)==[(0,8)]
assert e.keep_intervals(8,[0,3,7],[1,4,8],.1)==[(.9,3.1),(3.9,7.1)]
assert abs(e.map_time(5,[(0,2),(4,8)])-3)<.001
try:e.settings({'caption_font_size':100000})
except ValueError:pass
else:raise AssertionError('Out-of-range caption settings must be rejected.')

with tempfile.TemporaryDirectory(prefix='veo-edit-port-') as tmp:
    folder=pathlib.Path(tmp);source=folder/'combined.mp4'
    audio='aevalsrc=0.3*sin(2*PI*440*t)*(between(t\\,0.4\\,1.2)+between(t\\,2.6\\,3.5)):s=44100:d=4.5'
    e.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=size=180x320:rate=24:duration=4.5',
           '-f','lavfi','-i',audio,'-c:v','libx264','-preset','ultrafast','-c:a','aac',source])
    original=source.read_bytes()
    report=folder/'JOINED_CLIP_ORDER.txt'
    report.write_text(f'Completed video: {source}\n01 | 0.00s | one.mp4\n02 | 2.00s | two.mp4\n')
    cfg=e.settings({'silence_removal_enabled':True,'silence_min_duration':.3,'silence_padding':.1,
                   'editing_transitions_enabled':True,'transition_zoom_in':True,
                   'transition_zoom_in_duration':.2,'transition_sfx_zoom_in':'swoosh'})
    out=e.edit(source,cfg)
    info=e.probe(out);assert 1.8<info['duration']<2.7,info
    assert info['audio'] and info['width']==180 and info['height']==320
    assert source.read_bytes()==original
    receipt=json.loads((folder/'video_editing/last_edit.json').read_text())
    assert len(receipt['transition_boundaries'])==1
    assert abs(receipt['transition_boundaries'][0]-1)<.15
    mtime=out.stat().st_mtime_ns;e.edit(source,cfg);assert out.stat().st_mtime_ns==mtime
    # Real source camera algorithms produce valid full-size video frames.
    from moviepy import ImageClip
    from video_editing_port.source_effects import TransitionEffects
    clip=ImageClip(np.full((320,180,3),(60,100,140),dtype=np.uint8)).with_duration(1)
    for name,(method,direction,dur_key,dur_arg,extra) in e.TRANSITIONS.items():
        kwargs={k:cfg.get(v[1:]) if isinstance(v,str) and v.startswith('@') else v for k,v in extra.items()}
        kwargs[dur_arg]=.2
        frame=getattr(TransitionEffects,method)(clip,**kwargs).get_frame(.1)
        assert frame.shape==(320,180,3),(name,frame.shape)
    clip.close()
    # Captions use the original ASS generator for both export and preview.
    words=[dict(word='Kindness',start=.2,end=.7),dict(word='matters',start=.8,end=1.2)]
    ass=folder/'captions.ass';caption_cfg=e.settings({'clipper_captions_enabled':True,
        'clipper_caption_preset':'hormozi_green','clipper_caption_animation':'highlight',
        'caption_position':'center','caption_y_offset':10,'clipper_override_highlight_color':'#22D3EE'})
    e.build_captions(words,ass,e.probe(source),caption_cfg)
    body=ass.read_text();assert 'Dialogue:' in body and 'Montserrat' in body and '\\pos(90,170)' in body
    assert 'EED322' in body
    session='a'*32;preview.SESSIONS[session]=dict(source=source,folder=folder,info=e.probe(source),words=words,sample=False,render_lock=__import__('threading').Lock())
    png=preview.frame(dict(session=session,time=.3,settings=caption_cfg));assert png['image'].startswith('data:image/jpeg;base64,')
    video=preview.frame(dict(session=session,time=.3,settings=caption_cfg),True);assert e.probe(video)['audio']
    cross_cfg=e.settings({'silence_removal_enabled':True,'silence_min_duration':.3,'silence_padding':.1,'silence_crossfade_enabled':True,'silence_crossfade_duration':.15})
    cross=e.edit(source,cross_cfg,output=folder/'crossfaded.mp4');assert e.probe(cross)['duration']<info['duration']
    assert source.read_bytes()==original
    # Twenty short retained regions used to accumulate partial-frame padding
    # in FFmpeg concat and fail final validation / shift later boundaries.
    many=folder/'many_cuts.mp4'
    e.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=blue:s=180x320:r=24:d=20',
           '-f','lavfi','-i','aevalsrc=0.3*sin(2*PI*440*t)*lt(mod(t\\,1)\\,0.32):s=44100:d=20',
           '-c:v','libx264','-preset','ultrafast','-c:a','aac',many])
    many_out=e.edit(many,dict(silence_removal_enabled=True,silence_min_duration=.3,silence_padding=.1))
    cut_info=json.loads((folder/'video_editing/last_edit.json').read_text())
    planned=sum(end-start for start,end in cut_info['keep_intervals'])
    assert abs(e.probe(many_out)['duration']-planned)<.08
print('PASS: real silence cuts, mapped joins, 20 source effects, swoosh, crossfade+click, exact ASS preview/export, validation and preserved originals.')
