"""Audio First package isolation, speech-free prompts and real background mixing."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import audio_first as A
import video_editing as E

with tempfile.TemporaryDirectory() as temp:
    root=Path(temp);audio=root/'voice.wav'
    overrun=root/'overrun.wav'
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=880:duration=10.86',overrun])
    fitted,duration,rate=A.fit_narration(overrun,10)
    assert fitted!=overrun and 9.4<duration<=9.5 and 1.14<rate<1.16
    assert abs(A.V.audio_duration(overrun)-10.86)<.01,'Original audio must remain intact'
    long=root/'long.wav'
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=880:duration=12.49',long])
    _,duration,rate=A.fit_narration(long,10)
    assert duration<=9.5 and 1.31<rate<1.34
    fitted_story,common=A.fit_story([overrun,long],10)
    assert 1.31<common<1.34 and all(d<=9.5 for _,d in fitted_story)
    ratios=[A.V.audio_duration(original)/d for original,(_,d) in zip([overrun,long],fitted_story)]
    assert max(ratios)-min(ratios)<.01,'All scene recordings must have the same tempo'
    try:A.fit_narration(overrun,6)
    except ValueError as e:assert 'maximum 1.75x' in str(e)
    else:raise AssertionError('Large overflow must stop')
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=880:duration=2',audio])
    original={'title':'Audio First Test','preset_id':'3d-zack-style','narrated':True,'scene_seconds':4,'aspect_ratio':'9:16','style':'Colorful 3D','place':{'name':'Environment','description':'A workshop'},'character_descriptions':{},'scenes':[{'script_line':'A short test sentence.','narrative_context':'Follow the glowing mechanism through the workshop.','shots':[{'start_seconds':0,'end_seconds':4,'visual':'Track the spinning wheel.'}],'characters':[],'veo3_prompt':'NATIVE AUDIO: Narrator read exactly.'}]}
    source=root/'test_story.json';source.write_text(json.dumps(original));before=source.read_bytes()
    cfg=E.settings({'voiceover_mode':'local','voiceover_file':str(audio),'editing_camera_enabled':False})
    prepared=A.prepare({'story':str(source),'from':1,'to':1,'editingSettings':cfg})
    story=json.loads(prepared.read_text());assert story['audio_first'] and story['scenes'][0]['script_line']==''
    assert source.read_bytes()==before and prepared.parent!=source.parent
    prompt=(prepared.parent/'agent_prompt.txt').read_text(encoding='utf-8')
    assert 'ONLY natural environmental ambience' in prompt and 'Read exactly:' not in prompt and 'NATIVE AUDIO: Narrator read exactly' not in prompt
    raw=prepared.parent/'raw.mp4'
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=s=160x90:r=24:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-c:a','aac',raw])
    (prepared.parent/'JOINED_CLIP_ORDER.txt').write_text(f'Completed video: {raw}\n01 | 0.00s | scene1.mp4\n')
    with patch.object(E,'sync_video_thumbnail',return_value=None): final=E.edit(raw,{'editing_camera_enabled':False},output=prepared.parent/'final.mp4')
    assert E.probe(final)['audio'] and abs(E.probe(final)['duration']-4)<.1
    # The narration ends at 2s; the original background must remain audible afterwards.
    result=subprocess.run(['ffmpeg','-v','info','-ss','3','-i',str(final),'-t','0.3','-af','volumedetect','-f','null','-'],capture_output=True,text=True)
    import re
    db=float(re.search(r'mean_volume: ([\-\d.]+) dB',result.stderr).group(1))
    assert db>-45,'Background SFX were lost'
    with patch.object(E,'sync_video_thumbnail',return_value=None):
        trimmed=E.edit(raw,{'editing_camera_enabled':False,'silence_removal_enabled':True,'silence_min_duration':.3,'audio_first_trim_gaps':True},output=prepared.parent/'trimmed.mp4')
    assert 2<E.probe(trimmed)['duration']<3,'Narration-only detector must remove the padded gap despite audible background SFX'
    with patch.object(E,'sync_video_thumbnail',return_value=None):
        preserved=E.edit(raw,{'editing_camera_enabled':False,'silence_removal_enabled':True},output=prepared.parent/'preserved.mp4')
    assert abs(E.probe(preserved)['duration']-4)<.1,'Audio First must preserve full scene duration by default'
    selected=E.settings({'editing_camera_enabled':False,'camera_effect_line_spiral':True})
    assert not selected['editing_camera_enabled'] and E.selected_transitions(selected) and E.enabled(selected)
print('PASS: original preserved, separate package/checkpoints, narration instructions removed, prepared voice mixed over audible background, no paid generation.')
