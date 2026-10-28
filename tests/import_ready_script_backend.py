import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import desktop_app as app
p = dict(view='writer',readyScript='Title: Test\nSetting: Room\nClip 1:\nSarah: Hello.\nSAM: Hi.',preset='relationship-dialogue-dog-couple',seconds=8,aspect='9:16',transport='web',clips=75)
lane, ops = app.plan_action('import_script',p)
assert lane == 'writer'
assert ops[0][0] == 'request' and ops[0][1][0] == 'import_ready_script.js'
assert ops[0][1][1]['text'] == p['readyScript']
assert 'clips' not in ops[0][1][1] and 'transport' not in ops[0][1][1]
assert 'import_script' in app.RETRY_ACTIONS
print('PASS: direct import routes to local CLI, ignores AI transport/manual count and supports saved retry inputs.')

# Exercise the actual endpoint and Node parser without starting a desktop job.
from fastapi import HTTPException
preview=app.ready_script_preflight(p)
assert preview['reports'][0]['clips']==1
assert 'Hello.' in preview['reports'][0]['scenes'][0]['prompt']
try:
    app.ready_script_preflight(dict(p,readyScript='Title: Bad\nSetting: Room\nClip 2:\nSarah: Hello.'))
except HTTPException as exc:
    assert exc.status_code==400 and 'IMPORT_VALIDATION_FAILED' in exc.detail
else:
    raise AssertionError('Invalid script passed preflight')
print('PASS: preflight endpoint runs real local validation and returns prompts/errors without starting generation.')
