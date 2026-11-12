import json, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as D

with tempfile.TemporaryDirectory() as tmp, patch.object(D,'ROOT',Path(tmp)):
    root=Path(tmp)
    (root/'accounts.json').write_text(json.dumps({'accounts':[{'label':'A','email':'a@gmail.com'},{'label':'B','email':'b@gmail.com'}]}))
    rows=[]
    for i,email in enumerate(['a@gmail.com','b@gmail.com']):
        folder=root/'stories'/str(i);folder.mkdir(parents=True)
        story=folder/f'{i}_story.json'
        story.write_text(json.dumps({'title':str(i),'scene_seconds':10,'scenes':[{'script_line':'Narration.'}]}))
        rows.append(dict(story=str(story),gmail=email,project=f'https://flow.google.com/project/manual-{i}'))
    cfg=D.global_workflow_settings({})
    p={'view':'manual','manualJobs':json.dumps(rows),'_globalWorkflow':cfg,'manualApplyEditing':True}
    lane,ops=D.plan_action('manual_jobs',p)
    assert lane=='flow' and len(ops)==6
    for i in range(2):
        switch,download,join=ops[i*3:i*3+3]
        assert Path(switch[1][1]).name=='queue_account.js' and '--resume-only' in switch[1]
        assert switch[1][switch[1].index('--label')+1]==['A','B'][i]
        assert Path(download[1][1]).name=='agent_download.js' and '--upscaled' in download[1]
        assert download[1][download[1].index('--project-url')+1]==rows[i]['project']
        assert Path(join[1][1]).name=='join_clips.js'
    assert not any(x in str(ops) for x in ['agent_mode.js','generate_refs.js','--new-project','agent_batch_run.js'])
    record=dict(action='manual_jobs',payload=p,status='failed',operations=ops,operation_index=4)
    remaining=D.retry_plan(record)
    assert len(remaining)==3 and remaining[0][1]==ops[3][1] and remaining[1][1]==ops[4][1]
    job=D.Job('manual_jobs',p,lane,ops)
    assert job.payload['_editingSettings']['editing_auto_apply']
    class Process:
        def __init__(self,*args,**kwargs):self.stdout=[]
        def wait(self):return 0
    with patch.object(D.subprocess,'Popen',Process),patch.object(job,'reference_environment',return_value={}),patch.object(job,'refresh_flow_credits'):
        job._run_operations()
    assert Path(job.current_story).resolve()==Path(rows[1]['story']).resolve() and job.current_project_url==rows[1]['project'], (job.current_story,job.current_project_url,rows[1])
    assert job.project_account_email==rows[1]['gmail']
    for bad in [[rows[0],rows[0]],[dict(rows[0],gmail='unknown@gmail.com')],[dict(rows[0],project='https://example.com')],[]]:
        try:D.plan_action('manual_jobs',dict(p,manualJobs=bad))
        except ValueError:pass
        else:raise AssertionError('Invalid manual binding accepted')
    failed=D.Job('manual_jobs',p,lane,ops)
    calls=[]
    class FailedProcess(Process):
        def __init__(self,args,**kwargs):super().__init__();calls.append(args)
        def wait(self):return 1 if len(calls)==2 else 0
    with patch.object(D.subprocess,'Popen',FailedProcess),patch.object(failed,'reference_environment',return_value={}),patch.object(failed,'refresh_flow_credits'):
        try:failed._run_operations()
        except RuntimeError:pass
        else:raise AssertionError('Failed download did not stop queue')
    assert len(calls)==2 and failed.operation_index==1
print('PASS: manual queue uses bound Gmail/project/story, only finishes existing clips, resumes correct account and stops before next job on failure.')
