import importlib.util
import hashlib
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('desktop_app_retry_preflight', ROOT / 'desktop_app.py')
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)

with tempfile.TemporaryDirectory(prefix='agent-retry-preflight-') as temp:
    folder = Path(temp)
    story = folder / 'test_story.json'
    story.write_text(json.dumps({'title': 'test', 'scenes': [{'script_line': 'one'}]}), encoding='utf-8')
    project_id = '12345678-abcd-1234-abcd-123456789abc'
    checkpoint = folder / f'agent_batches_{project_id}.json.submission.json'
    fingerprint = hashlib.sha256(story.read_bytes()).hexdigest()
    checkpoint.write_text(json.dumps({'fingerprint': fingerprint, 'from': 1, 'to': 1, 'status': 'submitting'}), encoding='utf-8')
    state = folder / f'agent_batches_{project_id}.json'
    state.write_text(json.dumps({'project': project_id, 'fingerprint': fingerprint, 'total': 1,
                                 'completed': 0, 'pending': {'from': 1, 'to': 1,
                                 'prompt': str(folder / 'batch_001.txt')}}), encoding='utf-8')
    lane, steps = desktop.plan_action('retry_failed', {
        'story': str(story), 'project': f'https://flow.google.com/project/{project_id}', 'view': 'agent'
    })
    assert lane == 'flow'
    command = steps[0][1]
    assert '--retry-failed-only' in command
    assert Path(command[command.index('--refs') + 1]) == story.resolve(), command
    assert Path(command[command.index('--submission-file') + 1]) == checkpoint.resolve(), command

    record = {
        'action': 'generate', 'status': 'failed', 'operation_index': 0,
        'payload': {'view': 'agent', 'story': str(story),
                    'project': f'https://flow.google.com/project/{project_id}',
                    'model': 'Omni 1.1 Flash', 'resolution': '360p', 'aspect': '9:16',
                    'seconds': 8, 'cdp': 9222},
        'operations': [['cli', ['node', str(ROOT / 'join_clips.js'), str(folder / 'clips')]]],
    }
    resume = desktop.retry_plan(record)
    scripts = [next((Path(str(arg)).name for arg in spec if str(arg).endswith('.js')), '') for _, spec in resume]
    assert scripts == ['agent_mode.js', 'agent_download.js', 'order_clips_by_dialogue.js', 'join_clips.js'], scripts
    assert '--retry-failed-only' in resume[0][1]
    assert '--submission-file' in resume[0][1]

print('PASS: Agent failed-clip retry receives the story and project-matched batch checkpoint needed for preflight. ')
