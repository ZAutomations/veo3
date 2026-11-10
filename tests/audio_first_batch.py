"""Offline batch planning, package preparation and retry isolation contracts."""
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
import audio_first as A
import video_editing as E

with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);stories=[]
    for n in range(2):
        folder=root/str(n);folder.mkdir();file=folder/f'example_{n}_story.json'
        file.write_text(json.dumps({'title':f'Batch {n}','narrated':True,'scene_seconds':8,'aspect_ratio':'9:16',
          'style':'Colorful 3D','character_descriptions':{},'place':{'name':'Environment'},
          'scenes':[{'script_line':'A short complete test narration.','narrative_context':'Follow a rotating colorful wheel in the workshop.','characters':[],
                     'shots':[{'start_seconds':0,'end_seconds':8,'visual':'Track the moving wheel.'}]}]}))
        stories.append(str(file))
    globals=dict(app.GLOBAL_WORKFLOW_DEFAULTS,rotateQueueAccounts=False)
    cfg=E.settings({'voiceover_mode':'api','voiceover_provider':'heygen','voiceover_voice':'test-voice'})
    payload=dict(view='agent',queue=stories,queueAudioMode='audio_first',usePresetRefs=False,batchGenRefs=True,
                 download=True,join=True,_globalWorkflow=globals,_editingSettings=cfg)
    with patch('voiceover.synthesize',side_effect=AssertionError('Planning must not generate audio')):
        lane,ops=app.plan_action('generate_queue',payload)
    assert lane=='flow' and len(ops)==4
    assert [op[0] for op in ops]==['request','request','mcp','mcp']
    for i in range(2):
        request=ops[i][1][1];args=ops[i+2][1][1]
        assert request['story']==stories[i] and request['editingSettings']['voiceover_voice']=='test-voice'
        assert args['stories']==[str(A.plan_package(request)['file'])]
        assert args['new_project'] and args['generate_refs'] and args['download'] and args['join']
        assert not Path(args['stories'][0]).exists()
    record=dict(action='generate_queue',status='failed',payload=payload,operations=ops,operation_index=2,
                operation_projects={'2':'https://flow.google.com/project/story-one'},operation_phases={'2':'clips'})
    retry=app.retry_plan(record)
    assert len(retry)==2 and not retry[0][1][1]['new_project'] and retry[1][1][1]['new_project']
    assert retry[0][1][1]['project_url'].endswith('/story-one') and retry[1][1][1]['project_url']==''
    record.update(operation_index=1,operation_projects={},operation_phases={})
    retry=app.retry_plan(record)
    assert len(retry)==3 and retry[0][1][1]['story']==stories[1], 'Completed preparation must be skipped'
    _,native=app.plan_action('generate_queue',dict(payload,queueAudioMode='native'))
    assert len(native)==2 and all(op[0]=='mcp' for op in native)
    assert [op[1][1]['stories'][0] for op in native]==stories
    for view in ('ingredients','omni'):
        try:app.plan_action('generate_queue',dict(payload,view=view))
        except ValueError as exc:assert 'Agent Mode' in str(exc)
        else:raise AssertionError('Unsupported Audio First mode accepted')
    # Explicit per-story local recordings; verify packages exist before Flow would run.
    mapping={}
    for i,file in enumerate(stories):
        audio=root/f'voice{i}.wav'
        E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'sine=frequency={440+i*220}:duration=2',audio])
        mapping[file]={'audio':str(audio)}
    manifest=root/'audio.json';manifest.write_text(json.dumps(mapping))
    local=dict(payload,_editingSettings=E.settings({'voiceover_mode':'local'}),audioFirstLocalMap=str(manifest))
    _,localops=app.plan_action('generate_queue',local)
    for i in range(2):
        generated=A.prepare(localops[i][1][1])
        assert str(generated)==localops[i+2][1][1]['stories'][0]
        assert json.loads(generated.read_text())['audio_first']
    manifest.write_text(json.dumps({stories[0]:mapping[stories[0]]}))
    try:app.plan_action('generate_queue',local)
    except ValueError as exc:assert 'Missing local audio mapping' in str(exc)
    else:raise AssertionError('Missing second recording accepted')
print('PASS: prepare-all-first batch, Native unchanged, distinct packages/projects, per-story local recordings and safe preparation/generation retries; no paid calls.')
