import ast, json, hashlib
from pathlib import Path
root=Path(__file__).resolve().parent.parent
import sys
sys.path.insert(0,str(root))
code=ast.parse((root/'desktop_app.py').read_text(encoding='utf-8'))
functions=[n for n in code.body if isinstance(n,ast.FunctionDef) and n.name in ('library','story_completion','story_script_languages')]
for n in functions:n.decorator_list=[]
ns={'ROOT':root,'Path':Path,'json':json,'hashlib':hashlib,'read_json':lambda p:json.loads(p.read_text(encoding='utf-8-sig')) if p.is_file() else {},'presets':lambda:[]}
exec(compile(ast.Module(body=functions,type_ignores=[]),'library-test','exec'),ns)
rows=ns['library']()
tora=[r for r in rows if r['title']=='How the Battle of Tora Bora Shaped the Afghanistan War']
assert len(tora)==1,[(r['path'],r['done']) for r in tora]
assert tora[0]['done'],tora
assert not any('video_editing' in Path(r['path']).parts for r in rows)
print('PASS: Tora Bora appears once, marked done, absent from Available; internal language renders excluded')

import tempfile,os
with tempfile.TemporaryDirectory() as directory:
    folder=Path(directory);source=folder/'example_story.json'
    source.write_text(json.dumps({'title':'Example','scenes':[{}]}),encoding='utf-8')
    final=folder/'Example.mp4';final.write_bytes(b'completed-render')
    os.utime(final,(1,1))
    assert ns['story_completion'](source,{'title':'Example','scenes':[{}]}, {})['done']
    final.unlink()
    status=folder/'story_library_status.json'
    status.write_text(json.dumps({'already_done':True}),encoding='utf-8')
    result=ns['story_completion'](source,{'title':'Example','scenes':[{}]}, {})
    assert result['done'] and result['manuallyDone'] and not result['fullyComplete']
    status.write_text(json.dumps({'already_done':False}),encoding='utf-8')
    assert not ns['story_completion'](source,{'title':'Example','scenes':[{}]}, {})['done']
print('PASS: rewritten script retains completed video status; manual done persists and undo restores available')
