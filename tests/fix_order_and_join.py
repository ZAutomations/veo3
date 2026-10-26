import json,pathlib,sys,tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import desktop_app as app
with tempfile.TemporaryDirectory() as folder:
 p=pathlib.Path(folder)/'sample_story.json';p.write_text(json.dumps({'scenes':[{}],'scene_seconds':8}))
 for view in ['agent','ingredients','omni']:
  lane,ops=app.plan_action('fix_join',{'view':view,'story':str(p)})
  assert lane=='flow' and len(ops)==1
  assert ops[0][0]=='cli' and pathlib.Path(ops[0][1][1]).name=='fix_order_and_join.js'
  assert pathlib.Path(ops[0][1][2]).resolve()==p.resolve()
 assert app.automatic_retry_allowed('fix_join','flow')
print('PASS: Fix order & Join routes selected story through the safe local wrapper in all three workflow tabs; no browser or generation operations.')
