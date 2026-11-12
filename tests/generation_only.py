import json, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as D
import generation_only as G

with tempfile.TemporaryDirectory() as tmp, patch.object(D,'ROOT',Path(tmp)):
    root=Path(tmp)
    accounts={'current':0,'accounts':[{'label':'A','email':'a@gmail.com','max_clips':100},{'label':'B','email':'b@gmail.com','max_clips':100}]}
    (root/'accounts.json').write_text(json.dumps(accounts))
    stories=[]
    for n in range(2):
        folder=root/'stories'/str(n);folder.mkdir(parents=True)
        file=folder/f'{n}_story.json';file.write_text(json.dumps({'title':f'Story {n}','scene_seconds':8,'scenes':[{'veo3_prompt':'A scene.'}]}))
        stories.append(file)
    cfg=D.global_workflow_settings({'generationOnly':True,'rotateQueueAccounts':True,'videosPerAccount':1})
    p=D.global_workflow_payload({'view':'agent','queue':list(map(str,stories)),'download':True,'join':True,'_globalWorkflow':cfg})
    _,ops=D.plan_action('generate_queue',p)
    assert len(ops)==4
    assert [op[1][op[1].index('--label')+1] for op in ops if op[0]=='cli']==['A','B']
    for kind,spec in ops:
        if kind=='mcp':assert not spec[1]['download'] and not spec[1]['join'] and spec[1]['generate']
    for mode in ('ingredients','omni'):
        _,single=D.plan_action('generate',dict(p,view=mode,story=str(stories[0]),newProject=True))
        if mode=='ingredients':assert '--no-download' in single[-1][1] and '--join' not in single[-1][1]
        else:assert not single[-1][1][1]['download'] and not single[-1][1][1]['join']
    for n,file in enumerate(stories):
        G.generated(file,f'https://flow.google.com/project/project-{n}',accounts['accounts'][n],'agent',p)
    class Client:
        def __init__(self,*args,**kwargs):pass
        def start(self):pass
        def stop(self):pass
        def call_tool(self,*args):return {'text':'project -> https://flow.google.com/project/project-0','isError':False}
    job=D.Job('generate',dict(p,story=str(stories[0]),newProject=True),'flow',[ops[1]])
    with patch.object(D,'MCPClient',Client),patch.object(job,'reference_environment',return_value={}),patch.object(job,'refresh_flow_credits') as credits:
        job._run_operations()
        credits.assert_not_called()
    assert G.load(stories[0])['project'].endswith('project-0')
    state=G.load(stories[0]);assert state['account_email']=='a@gmail.com'
    assert D.story_completion(stories[0],json.loads(stories[0].read_text()),{})['generationOnlyPending']
    _,resume=D.plan_action('resume_generations',p)
    assert len(resume)==6
    for n in range(2):
        switch,download,join=resume[n*3:n*3+3]
        assert '--resume-only' in switch[1]
        assert switch[1][switch[1].index('--label')+1]==['A','B'][n]
        assert Path(download[1][1]).name=='agent_download.js'
        assert download[1][download[1].index('--project-url')+1].endswith(f'project-{n}')
        assert Path(join[1][1]).name=='join_clips.js'
    assert not any('agent_batch_run.js' in str(op) or 'new_project' in str(op) or 'generate_refs.js' in str(op) for op in resume)
    class Process:
        def __init__(self,*args,**kwargs):self.stdout=[]
        def wait(self):return 0
    finishing=D.Job('resume_generations',p,'flow',resume)
    assert finishing.payload['_editingSettings']['editing_auto_apply'] is True
    with patch.object(D.subprocess,'Popen',Process),patch.object(finishing,'reference_environment',return_value={}),patch.object(finishing,'refresh_flow_credits') as credits:
        finishing._run_operations()
        assert credits.call_count==2
    assert all(G.load(f)['status']=='complete' for f in stories)
    for n,file in enumerate(stories):G.generated(file,f'https://flow.google.com/project/project-{n}',accounts['accounts'][n],'agent',p)
    record=dict(action='resume_generations',payload=p,lane='flow',status='failed',operations=resume,operation_index=5,current_story=str(stories[1]))
    remaining=D.retry_plan(record)
    assert len(remaining)==2 and record['payload']['_resumeStory']==str(stories[1])
    assert remaining[0][1][remaining[0][1].index('--label')+1]=='B' and '--resume-only' in remaining[0][1]
    G.progress(stories[0],'Join and enabled editing',complete=True)
    assert not D.story_completion(stories[0],json.loads(stories[0].read_text()),{})['generationOnlyPending']
    before=stories[1].read_text();stories[1].write_text(before+' ')
    assert G.load(stories[1]) is None
    try:D.plan_action('resume_generations',p)
    except ValueError:pass
    else:raise AssertionError('Changed story resumed with stale project')
    assert 'apiKeys' not in state and set(state['settings']).issubset({'model','aspect','resolution','downloadVersion','seconds','cdp'})
print('PASS: generation-only defers finishing in all modes; durable account/project receipts; per-story resume with zero generation; correct account on retry; completion and changed-story guards.')
