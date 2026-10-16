import json, pathlib, tempfile, sys
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import desktop_app as studio
from fastapi.testclient import TestClient

with tempfile.TemporaryDirectory() as folder, patch.object(studio,'ROOT',pathlib.Path(folder)):
    record={'id':'failed','action':'generate','payload':{'view':'omni','project':'https://flow.google.com/project/same'},'lane':'flow','status':'failed','phase':'download','operation_index':1,
            'operations':[['cli',['node','already_completed.js']],['request',['single_clip_omni.js',{'story':'same-story.json','project':'','newProject':True}]],['cli',['node','join_clips.js']]]}
    remaining=studio.retry_plan(record)
    assert len(remaining)==2 and remaining[0][1][0]=='single_clip_omni.js'
    assert remaining[0][1][1]['project']==record['payload']['project']
    assert not remaining[0][1][1]['newProject']
    assert record['operations'][1][1][1]['newProject'],'original saved operation is not mutated'
    studio.save_json(studio.ROOT/'logs'/'desktop'/'last_omni_job.json',record)
    class Thread:
        def __init__(self,*args,**kwargs): pass
        def start(self): pass
    with TestClient(studio.app) as client, patch.object(studio.threading,'Thread',Thread):
        headers={'x-session-token':studio.TOKEN}
        response=client.post('/api/retry',json={'view':'omni','story':'different inputs ignored'},headers=headers)
        assert response.status_code==200,response.text
        job=studio.jobs[response.json()['id']]
        assert job.payload['project'].endswith('/same');assert len(job.operations)==2
        assert client.post('/api/retry',json={'view':'omni'},headers=headers).status_code==409
        job.status='completed';studio.jobs.clear()
    for action in ['manual','delete','account_remove']:
        try: studio.retry_plan(dict(record,action=action));raise AssertionError('unsafe replay allowed')
        except ValueError: pass
    ingredients=dict(record,payload={'view':'ingredients','project':'https://flow.google.com/project/existing'},operation_index=0,operations=[['cli',['node','veo3_flow_new_ui.js','story.json','--new-project','--from','1']]])
    cmd=studio.retry_plan(ingredients)[0][1]
    assert '--resume-auto' in cmd and '--new-project' not in cmd
print('PASS: Retry resumes the failed operation with saved inputs across restart; completed operations skipped, live lane blocked, destructive/manual replay blocked, Ingredients uses verified timeline resume.')
