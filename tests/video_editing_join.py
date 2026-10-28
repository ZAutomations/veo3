import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import video_editing as e

with tempfile.TemporaryDirectory(prefix='veo-join-edit-') as temp:
    folder=Path(temp);clips=folder/'clips';clips.mkdir()
    for name,color in [('first','red'),('second','blue')]:
        e.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'color={color}:s=180x320:r=24:d=2',
               '-f','lavfi','-i','sine=frequency=440:duration=1','-af','apad','-t','2',
               '-c:v','libx264','-preset','ultrafast','-c:a','aac',clips/(name+'.mp4')])
    cfg=e.settings(dict(silence_removal_enabled=True,silence_min_duration=.3,silence_padding=.05,
                       editing_transitions_enabled=True,transition_zoom_in=True,transition_zoom_in_duration=.2))
    env=os.environ.copy();env['VEO_EDITING_SETTINGS']=json.dumps(cfg);env['VEO_PYTHON']=sys.executable
    result=subprocess.run(['node',str(ROOT/'join_clips.js'),str(clips),'--order','second,first'],
                          cwd=ROOT,env=env,capture_output=True,text=True,timeout=120)
    assert result.returncode==0,result.stdout+result.stderr
    raw=folder/'clips_final.mp4';edited=folder/'clips_final_edited.mp4'
    assert raw.is_file() and edited.is_file(),result.stdout
    assert e.probe(raw)['duration']>3.8
    assert 1.8<e.probe(edited)['duration']<2.6
    report=(folder/'JOINED_CLIP_ORDER.txt').read_text();assert report.index('second.mp4')<report.index('first.mp4')
    receipt=json.loads((folder/'video_editing/last_edit.json').read_text());assert len(receipt['transition_boundaries'])==1
    assert 'EDITED_VIDEO:' in result.stdout
    # Disabling auto editing preserves the original Join behavior.
    cfg['editing_auto_apply']=False;env['VEO_EDITING_SETTINGS']=json.dumps(cfg)
    second=folder/'without_edit.mp4'
    result=subprocess.run(['node',str(ROOT/'join_clips.js'),str(clips),'--order','second,first','--out',str(second)],cwd=ROOT,env=env,capture_output=True,text=True,timeout=120)
    assert result.returncode==0 and second.is_file(),result.stderr
    assert not (folder/'without_edit_edited.mp4').exists()
print('PASS: actual verified-order Join invokes editing, preserves the raw combined video, maps boundaries, and respects auto-edit disable.')
