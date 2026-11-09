import json
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from story_duplicate_check import check

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    folder = root / 'stories' / 'moved' / 'nested'
    folder.mkdir(parents=True)
    (folder / 'test_story.json').write_text(json.dumps(dict(title='Why Does Your Heart Race?', preset_id='intimacy-health-3d')))
    p = dict(preset='intimacy-health-3d', ideas='Story 1\nTitle: WHY does your heart race!\nDetails: Test')
    assert len(check(root, 'write', p)) == 1
    assert not check(root, 'write', dict(p, preset='3d-zack-style'))
    text = 'Story 1\nTitle: Why Does Your Heart Race?\nPreset: intimacy-health-3d\n\nStory 2\nTitle: New topic\nPreset: intimacy-health-3d'
    assert len(check(root, 'import_script', dict(readyScript=text))) == 1
    assert check(root, 'import_script', dict(readyScript=text+'\n\nStory 3\nTitle: New topic\nPreset: intimacy-health-3d'))[1]['occurrences'] == 2
    assert not check(root, 'generate', p)
    assert not check(root, 'write', dict(p, ideas='An entirely new topic'))
print('PASS: preset-scoped existing titles, punctuation/case normalization, nested saved stories, duplicate batch entries, no generation interference.')
