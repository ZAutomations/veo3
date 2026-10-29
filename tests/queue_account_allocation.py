import sys,tempfile,json
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
original=app.read_json
store=dict(current=0,accounts=[dict(label=n,clips_month='2000-01',clips_used=100,max_clips=100) for n in ['A','B','C']])
with tempfile.TemporaryDirectory() as tmp:
    paths=[]
    for i in range(6):
        p=Path(tmp)/f'story{i}.json';p.write_text(json.dumps(dict(title=f'Film {i}',scenes=[dict(veo3_prompt='test')]*2)));paths.append(str(p))
    def read(p,*args,**kw):return store if Path(p).name=='accounts.json' else original(p,*args,**kw)
    for view in ['agent','omni','ingredients']:
        payload=dict(view=view,queue=paths,rotateQueueAccounts=True,videosPerAccount=2,_globalWorkflow=dict(rotateQueueAccounts=True,videosPerAccount=2),model='Omni 1.1 Flash',resolution='360p',aspect='9:16',cdp=9222,download=False,join=False)
        with patch.object(app,'read_json',side_effect=read):_,ops=app.plan_action('generate_queue',payload)
        guards=[spec for kind,spec in ops if kind=='cli' and str(spec[1]).endswith('queue_account.js')]
        assert [spec[spec.index('--label')+1] for spec in guards]==['A','A','B','B','C','C']
        assert all('--cdp' in spec for spec in guards)
        if view=='omni':assert [spec[1]['account'] for kind,spec in ops if kind=='request']==['A','A','B','B','C','C']
        if view=='agent':assert all(spec[1]['new_project'] for kind,spec in ops if kind=='mcp')
        with patch.object(app,'read_json',side_effect=read):_,off=app.plan_action('generate_queue',dict(payload,rotateQueueAccounts=False,_globalWorkflow=dict(rotateQueueAccounts=False)))
        assert not any(kind=='cli' and 'queue_account.js' in str(spec) for kind,spec in off)
    store['accounts'][1]['paused']=True
    with patch.object(app,'read_json',side_effect=read):_,ops=app.plan_action('generate_queue',payload)
    guards=[spec for kind,spec in ops if kind=='cli' and str(spec[1]).endswith('queue_account.js')]
    assert [spec[spec.index('--label')+1] for spec in guards]==['A','A','C','C','A','A']
    for account in store['accounts']:account['paused']=True
    with patch.object(app,'read_json',side_effect=read):
        try:app.plan_action('generate_queue',payload)
        except ValueError as e:assert 'Nothing started' in str(e)
        else:raise AssertionError('No eligible accounts should fail preflight')
print('PASS: all three generation queues allocate 1–2/A, 3–4/B, 5–6/C; separate projects, Omni identity, disabled mode and availability preflight.')
