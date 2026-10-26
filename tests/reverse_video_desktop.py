import json
from pathlib import Path
import shutil
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import reverse_video_desktop as R
import desktop_app as A

ROOT = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    video = root / 'ref.mp4'
    video.write_bytes(b'local fixture')
    assert len(R.request_payload(root, {'videos': [str(video)]})['videos']) == 1
    for request in ({'videos': []}, {'videos': [str(video)] * 4}, {'videos': [str(video), str(video)]}):
        try:
            R.request_payload(root, request)
            raise AssertionError('Invalid input accepted')
        except ValueError:
            pass
    try:
        R.run_folder(root, '../escape')
        raise AssertionError('Path traversal accepted')
    except ValueError:
        pass
    run_id = 'a' * 24
    folder = R.run_folder(root, run_id)
    folder.mkdir(parents=True)
    (folder / 'complete.json').write_text('{}')
    (folder / 'request.json').write_text(json.dumps({'options': {'name': 'Test'}}))
    (folder / 'secret.txt').write_text('not a returned artifact')
    assert 'secret.txt' not in R.read_run(root, run_id)['files']
    for filename in ('styles.json', 'genai_styles.json'):
        (root / filename).write_text('{"styles": []}')
    shutil.copy(ROOT / 'reverse_video_contract.js', root)
    p = dict(id='reference-unit-test', name='Unit test', style='3D matte shapes', direction='Hook, action, payoff', camera='Static shot', sound_style='Quiet native foley', ready_script_mode='silent_visual', reference_cast=[], aspect_ratio='9:16', default_clips=8, scene_seconds=8)
    body = dict(id=run_id, preset=p, master='A complete reviewed master prompt. ' * 8)
    saved = R.register(root, body)
    assert saved['preset_id'] == p['id']
    assert json.loads((root / 'genai_styles.json').read_text())['styles'][0]['derived_video_preset']
    assert (root / 'Master prompts' / (p['id'] + '.txt')).read_text() == body['master']
    try:
        R.register(root, body)
        raise AssertionError('Existing preset overwritten')
    except ValueError:
        pass
    lane, ops = A.plan_action('reverse_video', dict(videos=[str(video)], view='reverse'))
    assert lane == 'writer' and ops[0][1][0] == 'reverse_video_engine.js'
    assert A.automatic_retry_allowed('reverse_video', 'writer')
print('PASS: video limits, local job plan, safe artifact access, reviewed registration, collision protection and saved master prompt.')
