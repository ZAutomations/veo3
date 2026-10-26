import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
from fastapi import HTTPException
items=app.master_prompt_list()
assert len(items)==len(app.presets())
for preset in ['3d-zack-style','fern-documentary','3d-motivational-red-green']:
    result=app.master_prompt(preset)
    expected=(app.ROOT/'Master prompts'/(preset+'.txt')).read_text(encoding='utf-8-sig')
    assert result['text']==expected and expected.strip()
try:app.master_prompt('../../gui_settings')
except HTTPException as e:assert e.status_code==400
else:raise AssertionError('Unknown paths must be rejected')
with TemporaryDirectory() as tmp,patch.object(app,'ROOT',Path(tmp)),patch.object(app,'presets',return_value=[dict(id='test',name='Test',group='Classic')]):
    assert app.master_prompt_list()[0]['available'] is False
    try:app.master_prompt('test')
    except HTTPException as e:assert e.status_code==404
    else:raise AssertionError('Missing prompt should be explicit')
print('PASS: live saved master prompt content, preset allowlist, traversal rejection and missing-file handling.')
