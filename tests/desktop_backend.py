"""Desktop adapter tests: no browser generation, network AI calls or real deletion."""
import json
import pathlib
import sys
import tempfile
import threading
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import desktop_app as studio
from fastapi.testclient import TestClient


with tempfile.TemporaryDirectory() as directory:
    story = pathlib.Path(directory) / 'sample_story.json'
    story.write_text(json.dumps({'title':'Adapter test', 'scene_seconds':8,
        'scenes':[{'veo3_prompt':f'Prompt {i}', 'dialogue':[]} for i in range(13)]}))
    inputs = dict(story=str(story), project='https://flow.google.com/project/test-project',
                  view='omni', model='Omni 1.1 Flash', resolution='360p', aspect='9:16',
                  cdp=9222, **{'from':11, 'to':13}, reuseRefs=True, download=True)
    lane, operations = studio.plan_action('generate', inputs)
    assert lane == 'flow'
    _, (driver, request) = operations[0]
    assert driver == 'single_clip_omni.js'
    assert request['from'] == 11 and request['to'] == 13 and request['resolution'] == '360p'
    assert request['reuseRefs'] and not request['genRefs']
    _, operations = studio.plan_action('download', inputs)
    assert operations[0][1][1]['downloadOnly']
    _, operations = studio.plan_action('join', inputs)
    assert pathlib.Path(operations[0][1][-1]).resolve() == (story.parent / 'clips').resolve()
    assert '--reverse' not in operations[0][1] and '--order' not in operations[0][1]
    _, operations = studio.plan_action('order', inputs)
    assert '--write' in operations[0][1] and '--clips' in operations[0][1]
    _, operations = studio.plan_action('manual', dict(inputs, view='agent', selectionType='clips', selection='2,8,6'))
    assert '--clips' in operations[0][1] and '2,8,6' in operations[0][1] and '--settings' not in operations[0][1]
    _, operations = studio.plan_action('generate', dict(inputs, view='agent'))
    args = operations[1][1]
    assert 'agent_batch_run.js' in args[1] and '--no-upload-refs' in args and '360p' in args
    assert inputs['project'] in args
    assert 'story_to_agent_prompt.js' in operations[0][1][1]
    _, operations = studio.plan_action('generate', dict(inputs, view='ingredients', newProject=True, genRefs=True))
    assert '--new-project' not in operations[0][1] and '--gen-refs' not in operations[0][1]
    assert '--from' in operations[0][1]
    try:
        studio.plan_action('delete', inputs)
        raise AssertionError('Unconfirmed deletion was allowed')
    except ValueError:
        pass
    try:
        studio.plan_action('manual', dict(inputs, selection='99', selectionType='clips'))
        raise AssertionError('Out-of-range selection was allowed')
    except ValueError:
        pass
    preset = studio.presets()[0]['id']
    source = 'https://www.youtube.com/shorts/NEW_SOURCE'
    lane, operations = studio.plan_action('write', dict(preset=preset, source='links', links=source, matchSource=True, clips=8))
    assert lane == 'writer'
    assert operations[0][1][1]['references'] == [source]
    assert operations[0][1][1]['match_ref'] and not operations[0][1][1]['generate']
    try:
        studio.plan_action('write', dict(preset=preset, ideas='A calm story', clips=5, seconds=1))
        raise AssertionError('1-second writing was allowed')
    except ValueError:
        pass
    studio.jobs.clear()
    client = TestClient(studio.app)
    headers = {'X-Session-Token':studio.TOKEN}
    assert client.get('/api/bootstrap').status_code == 403
    assert client.post('/api/jobs',headers={**headers,'Origin':'https://other.example'},json={'action':'join','payload':inputs}).status_code == 403
    assert client.get('/api/bootstrap', headers=headers).status_code == 200
    assert 'gemini_api_keys' not in client.get('/api/bootstrap', headers=headers).text
    held = threading.Event()
    def fake_run(job):
        held.wait(2)
        job.status = 'completed'
    with patch.object(studio.Job, 'run', fake_run), patch.object(studio, 'save_json'):
        first = client.post('/api/jobs', headers=headers, json={'action':'generate','payload':inputs})
        assert first.status_code == 200
        duplicate = client.post('/api/jobs', headers=headers, json={'action':'join','payload':inputs})
        assert duplicate.status_code == 409
        writer = client.post('/api/jobs', headers=headers, json={'action':'write','payload':dict(preset=preset, ideas='A new title\nA brief.', clips=8)})
        assert writer.status_code == 200
        switch = client.post('/api/jobs', headers=headers, json={'action':'account_use','payload':{'label':'test'}})
        assert switch.status_code == 409
        held.set()
    # A stopped MCP job may finish connecting, but must not submit an AI request.
    job = studio.Job('write', {}, 'writer', [('mcp', ('batch_pipeline', {}))])
    class FakeClient:
        def __init__(self,*args,**kwargs): pass
        def start(self): job.stopped=True
        def call_tool(self,*args): raise AssertionError('Cancelled request was submitted')
        def stop(self): pass
    with patch.object(studio, 'MCPClient', FakeClient), patch.object(studio, 'save_json'):
        job.run()
    assert job.status == 'stopped'
    studio.jobs.clear()
print('PASS: desktop adapters, scene ranges, prompt-only resolution, safe order, current source, confirmation, private API and independent job lanes.')
