from pathlib import Path
from tempfile import TemporaryDirectory
import json,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from desktop_app import bind_prepared_output
with TemporaryDirectory() as tmp:
 root=Path(tmp).resolve()
 source=root/'original_story.json';source.write_text('{}')
 prepared=root/'full_voiceover'/'actual'/'full_voiceover_story.json'
 prepared.parent.mkdir(parents=True)
 prepared.write_text(json.dumps(dict(audio_first=True,original_story=str(source),scenes=[{}])))
 stale=root/'full_voiceover'/'old'/'full_voiceover_story.json'
 operations=[('request',('full_voiceover.py',dict(story=str(source)))),
             ('mcp',('batch_pipeline',dict(stories=[str(stale)],generate=True)))]
 assert bind_prepared_output(operations,0,str(prepared))
 assert operations[1][1][1]['stories']==[str(prepared)]
 assert not bind_prepared_output(operations,1,str(prepared))
print('PASS: downstream generation follows the worker actual verified output, independent of planned cache hash.')
