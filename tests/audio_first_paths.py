import json,sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import audio_first as A
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp)
    story_dir=root/('long_story_'+'a'*70);story_dir.mkdir()
    source=story_dir/('long_story_'+'a'*70+'_story.json')
    source.write_text(json.dumps(dict(title='Long story',narrated=True,scene_seconds=8,scenes=[dict(script_line='A complete explanation.')])))
    body=dict(story=str(source),editingSettings=dict(voiceover_mode='api',voiceover_provider='heygen',voiceover_voice='test'))
    planned=A.plan_package(body)
    assert planned['file'].name=='audio_first_story.json'
    assert planned['file'].parent==planned['folder']
    planned['folder'].mkdir(parents=True)
    planned['file'].write_text('{}')
    assert planned['file'].read_text()=='{}'
    assert A.plan_package(body)['file']==planned['file']
    legacy=planned['folder']/(source.stem+'_audio_first_story.json')
    planned['file'].write_text(json.dumps(dict(audio_first=True,original_story=str(source))))
    op=['mcp',['tool',dict(stories=[str(legacy)])]]
    repaired=A.rebind_package_paths(op)
    assert repaired[1][1]['stories']==[str(planned['file'])]
    assert op[1][1]['stories']==[str(legacy)], 'Do not mutate saved inputs'
    planned['file'].write_text(json.dumps(dict(audio_first=True,original_story=str(root/'other_story.json'))))
    assert A.rebind_package_paths(op)==op, 'Never bind an unrelated package'
    short=root/'test_story.json'
    assert A.package_file(root,short)==root/'test_story_audio_first_story.json'
print('PASS: long Audio First names use writable short paths; planning/retry/cache folder stay consistent; short existing names preserved. No API calls.')
