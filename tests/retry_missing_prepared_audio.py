from pathlib import Path
import json
from tempfile import TemporaryDirectory
from unittest.mock import patch
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
import full_voiceover

with TemporaryDirectory() as directory:
    target=Path(directory)/'full_voiceover'/'hash'/'full_voiceover_story.json'
    target.parent.mkdir(parents=True)
    prep=('request',('full_voiceover.py',{'story':'original.json'}))
    flow=('mcp',('batch_pipeline',{'stories':[str(target)],'generate':True}))
    record=dict(action='generate_queue',status='stopped',operation_index=0,operations=[flow],
                operation_projects={},operation_phases={'0':'refs'},payload={'queueAudioMode':'full_voiceover'})
    with patch.object(full_voiceover,'plan_package',return_value={'file':target}), \
         patch.object(app,'plan_action',return_value=('flow',[prep,flow])) as rebuilt:
        restored=app.retry_plan(record)
        assert [step[0] for step in restored]==['request','mcp']
        assert restored[1][1][1]['stories']==[str(target)]
        assert record['operation_phases']=={'1':'refs'}
        assert rebuilt.call_count==1
        target.write_text('{}')
        assert len(app.retry_plan(record))==1
        assert rebuilt.call_count==1
print('PASS: retry restores missing prepared audio only, preserves Flow inputs, and skips existing packages.')

with TemporaryDirectory() as directory:
    source = Path(directory) / 'original_story.json'
    saved = source.parent / 'full_voiceover' / 'old' / 'full_voiceover_story.json'
    candidate = saved.parent.parent / 'current' / saved.name
    candidate.parent.mkdir(parents=True)
    audio = candidate.parent / 'narration.wav'
    audio.touch()
    package = dict(audio_first=True, full_voiceover_first=True, original_story=str(source),
                   full_voiceover_file=str(audio), scenes=[{'scene': 1}])
    candidate.write_text(json.dumps(package))
    request = ('request', ('full_voiceover.py', {'story': str(source)}))
    args = dict(stories=[str(saved)], generate=True, new_project=True)
    flow = ('mcp', ('batch_pipeline', args))
    record = dict(action='generate_queue', status='failed', operation_index=2,
                  operations=[request, request, flow], payload={'queueAudioMode': 'full_voiceover'})
    with patch.object(full_voiceover, 'plan_package', return_value={'file': candidate, 'source': source}):
        retry = app.retry_plan(record)
        assert len(retry) == 1
        assert retry[0][1][1] == dict(args, stories=[str(candidate)])
        assert args['stories'] == [str(saved)]
        app.rebind_missing_full_voiceover(flow, [request], 'clips')
        assert args['stories'] == [str(saved)]
        ambiguous = ('request', ('full_voiceover.py', {'story': str(source), 'defer_dubbing': True}))
        app.rebind_missing_full_voiceover(flow, [request, ambiguous], None)
        assert args['stories'] == [str(saved)]
        candidate.write_text(json.dumps(dict(package, original_story='different.json')))
        app.rebind_missing_full_voiceover(flow, [request], None)
        assert args['stories'] == [str(saved)]
        candidate.write_text(json.dumps(package))
        app.rebind_missing_full_voiceover(flow, [request], None)
        assert args['stories'] == [str(candidate)]
print('PASS: full voiceover retry recovers the verified package before Flow and rejects unsafe bindings.')
