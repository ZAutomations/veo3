"""Real FFmpeg timeline checks; provider synthesis is mocked, no paid API calls."""
import array
import json
from pathlib import Path
import subprocess
import tempfile
import sys
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import video_editing as E
import voiceover as V

with tempfile.TemporaryDirectory() as temp:
    folder=Path(temp);work=folder/'work';work.mkdir()
    source=folder/'raw.mp4'
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=s=160x90:r=24:d=5','-c:v','libx264',source])
    report=folder/'JOINED_CLIP_ORDER.txt'
    report.write_text(f'Completed video: {source}\n01 | 0.00s | scene1.mp4\n02 | 2.00s | scene2.mp4\n03 | 4.00s | image.png (thumbnail end card)\n')
    (folder/'example_story.json').write_text(json.dumps({'narrated':True,'scenes':[{'script_line':'First line'},{'script_line':'Second line'}]}))
    cfg=E.settings({'voiceover_mode':'api','voiceover_voice':'test','voiceover_provider':'elevenlabs','editing_camera_enabled':False})
    def synth(provider,voice,text,target):
        E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'sine=frequency={440 if text=="First line" else 880}:duration=1',target])
        return target
    output=folder/'voice.mp4'
    with patch.object(V,'synthesize',synth): V.replace_audio(source,output,cfg,work)
    def sample(when):
        raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(when),'-i',str(output),'-t','0.2','-f','s16le','-ac','1','-ar','16000','-'])
        values=array.array('h',raw)
        energy=sum(abs(v) for v in values)/len(values)
        hz=sum(a<0<=b for a,b in zip(values,values[1:]))/.2
        return energy,hz
    assert abs(E.probe(output)['duration']-5)<.1
    assert abs(sample(.2)[1]-440)<15 and abs(sample(2.2)[1]-880)<15
    assert sample(1.5)[0]<5 and sample(4.3)[0]<5, 'Padding and thumbnail must be silent'
    local=folder/'local.wav';E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=duration=4',local])
    localcfg=E.settings({'voiceover_mode':'local','voiceover_file':str(local)})
    V.replace_audio(source,folder/'local.mp4',localcfg,work)
    localcfg['editing_camera_enabled']=False
    with patch.object(E,'sync_video_thumbnail',return_value=None):
        edited=E.edit(source,localcfg,output=folder/'final.mp4')
    assert E.probe(edited)['audio'] and abs(E.probe(edited)['duration']-5)<.1
    timing=folder/'timing.json';timing.write_text(json.dumps([{'audio_start':0,'audio_end':4,'video_start':0,'video_end':1}]))
    localcfg['voiceover_timing']=str(timing)
    try: V.replace_audio(source,folder/'bad.mp4',localcfg,work)
    except ValueError as e: assert 'no speech was truncated' in str(e)
    else: raise AssertionError('Excessive speed must be rejected')
    assert E.defaults()['voiceover_mode']=='native'
print('PASS: scene voice identity/timing, silent padding/end card, local WAV, overflow refusal and native default; no paid calls.')
