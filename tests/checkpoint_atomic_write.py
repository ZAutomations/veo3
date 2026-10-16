import concurrent.futures
import json
import pathlib
import tempfile
from unittest.mock import patch
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import desktop_app as studio

with tempfile.TemporaryDirectory() as folder:
    target = pathlib.Path(folder) / 'last_agent_job.json'
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as workers:
        list(workers.map(lambda n: studio.save_json(target, {'number': n, 'payload': 'test' * 100}), range(40)))
    assert isinstance(json.loads(target.read_text())['number'], int)
    assert not list(pathlib.Path(folder).glob('*.tmp'))
    original = pathlib.Path.replace
    attempts = []
    def replace(staging, destination):
        attempts.append(str(staging))
        if len(attempts) < 3:
            raise PermissionError(13, 'Windows sharing violation')
        return original(staging, destination)
    with patch.object(pathlib.Path, 'replace', replace), patch.object(studio.time, 'sleep'):
        studio.save_json(target, {'status': 'stopped', 'operation_index': 1})
    assert len(attempts) == 3
    assert json.loads(target.read_text())['operation_index'] == 1
    assert not list(pathlib.Path(folder).glob('*.tmp'))
print('PASS: concurrent checkpoint writes and temporary Windows file locks preserve valid Retry state.')
