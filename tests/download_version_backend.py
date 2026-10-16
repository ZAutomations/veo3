import json,pathlib,sys,tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import desktop_app as app
with tempfile.TemporaryDirectory() as folder:
    file=pathlib.Path(folder)/'story.json';file.write_text(json.dumps({'scenes':[{}]*7,'scene_seconds':8}))
    p=dict(story=str(file),view='agent',model='Omni 1.1 Flash',resolution='360p',aspect='9:16',seconds=8,project='https://flow.google.com/project/example',downloadVersion='original',download=True)
    _,ops=app.plan_action('download',p)
    assert '--original' in ops[0][1] and '--upscaled' not in ops[0][1]
    _,ops=app.plan_action('generate',dict(p,newProject=True))
    assert ops[0][1][1]['download_version']=='original'
    _,ops=app.plan_action('generate_queue',dict(p,queue=[str(file)]))
    assert ops[0][1][1]['download_version']=='original'
    _,ops=app.plan_action('generate',dict(p,view='omni',reuseRefs=True))
    assert ops[0][1][1]['downloadVersion']=='original'
    record=dict(action='generate',payload=dict(p,view='omni'),operations=ops,operation_index=0,status='failed')
    assert app.retry_plan(record)[0][1][1]['downloadVersion']=='original'
    print('PASS: Original choice reaches buttons, Agent queues, Omni generation and saved retry operations.')
