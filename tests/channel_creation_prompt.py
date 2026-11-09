import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import desktop_app as app
from channel_creation_prompt import build
from fastapi import HTTPException

for preset in app.presets():
    result = app.master_prompt(preset['id'], 'channel')
    assert result['id'] == preset['id'] and result['kind'] == 'channel'
    assert f"SELECTED PRESET: {preset['id']}" in result['text']
    for required in ('FIRST RESPONSE', 'AFTER I SELECT A NAME', 'UPLOAD_DEFAULTS', 'TikTok', 'Facebook', 'logo', '2560×1440'):
        assert required in result['text'], required
    assert result['text'] == (app.ROOT / 'Master prompts' / 'Channel creation' / (preset['id'] + '.txt')).read_text(encoding='utf-8')

health = app.master_prompt('intimacy-health-3d', 'channel')['text']
maps = app.master_prompt('geography-map', 'channel')['text']
assert 'Facts Vs Myths Decoded' in health
assert 'Map Animation' in maps
assert 'SELECTED PRESET: geography-map' not in health
assert app.master_prompt('geography-map')['text'] != maps
for preset, kind in [('../../accounts', 'channel'), ('geography-map', 'invalid'), ('video-reverse-engineering', 'channel')]:
    try:
        app.master_prompt(preset, kind)
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError('Invalid prompt request must fail')

with TemporaryDirectory() as temp:
    root = Path(temp)
    (root / 'Master prompts' / 'Channel creation').mkdir(parents=True)
    (root / 'Master prompts' / 'Channel creation' / '_template.txt').write_text('channel template')
    (root / 'genai_styles.json').write_text(json.dumps({'styles': [{'id': 'reference-future', 'name': 'Future niche', 'audience': 'Distinct viewers', 'style': 'Painted paper models'}]}))
    text = build(root, 'reference-future')
    assert all(term in text for term in ('Future niche', 'Distinct viewers', 'Painted paper models'))
print('PASS: all 65 preset-specific channel prompts, saved copies, future custom presets, separate story prompt, invalid requests rejected.')
