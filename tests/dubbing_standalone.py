"""Verify concurrent Studio generation and standalone dubbing without provider calls."""
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import desktop_app as studio
from fastapi import HTTPException


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    preferences = {'writer': root / 'writer.json', 'dubbing': root / 'dubbing.json'}
    real_plan = studio.plan_action

    def plan(action, payload):
        if action == 'generate':
            return 'flow', [('cli', ['node', 'agent_batch_run.js'])]
        return real_plan(action, payload)

    with (patch.object(studio, 'ROOT', root),
          patch.object(studio, 'STATE', root / 'studio.json'),
          patch.object(studio, 'STANDALONE_STATES', preferences),
          patch.object(studio, 'jobs', {}),
          patch.object(studio, 'plan_action', side_effect=plan),
          patch.object(studio.threading, 'Thread'),
          patch('local_dubbing.plan', return_value={'jobs': []})):
        studio.preferences({'forms': {'audio': {'localDubFolder': 'Studio'}}}, 'studio')
        assert studio.surface_preferences('dubbing')['forms']['audio']['localDubFolder'] == 'Studio'
        studio.preferences({'forms': {'audio': {'localDubFolder': 'Separate'}}}, 'dubbing')
        assert studio.surface_preferences('studio')['forms']['audio']['localDubFolder'] == 'Studio'
        assert studio.surface_preferences('dubbing')['forms']['audio']['localDubFolder'] == 'Separate'

        request = {'action': 'render_local_multilingual', 'payload': {'view': 'audio', 'localDubFolder': 'Fixture'}}
        dub = studio.start_job(request)
        assert dub['lane'] == 'dubbing'
        generation = studio.start_job({'action': 'generate', 'payload': {'view': 'agent'}})
        assert generation['lane'] == 'flow'
        try:
            studio.start_job(request)
        except HTTPException as exc:
            assert exc.status_code == 409
        else:
            raise AssertionError('Two dubbing jobs were allowed in the same queue')

        dub_job = studio.jobs[dub['id']]
        dub_job.status = 'failed'
        dub_job.save_progress()
        resumed = studio.retry_workflow({'view': 'dubbing'})
        assert resumed['lane'] == 'dubbing'
        assert studio.jobs[resumed['id']].operations[0][1][1]['folder'] == 'Fixture'
        assert studio.jobs[generation['id']].status == 'running'
        assert not (root / 'logs' / 'desktop' / 'last_agent_job.json').exists()

print('PASS: separate preferences, concurrent Flow and dubbing, isolated Retry / Continue.')
