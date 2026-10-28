import sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
class Delay:
    def __init__(self):self.calls=[]
    def wait(self,n):self.calls.append(n);return False
with tempfile.TemporaryDirectory() as tmp,patch.object(app,'ROOT',Path(tmp)):
    for action,lane in [('write','writer'),('import_script','writer'),('refs','flow'),('generate','flow'),('download','flow'),('order','flow'),('join','flow')]:
        job=app.Job(action,{'view':'writer' if lane=='writer' else 'agent'},lane,[('cli',['node','some_step.js'])])
        delay=Delay();job._stop_event=delay;calls=[]
        def perform():
            calls.append(1)
            if len(calls)<3:raise RuntimeError('A previously unseen error sentence')
        with patch.object(job,'_run_operations',perform):job.run()
        assert job.status=='completed' and job.auto_retry_count==2,(action,list(job.logs))
        assert delay.calls==([8,16] if action=='import_script' else [8,8])
    # A known clip-stage checkpoint must not be changed back to reference
    # preparation because an earlier attempt logged a reference timeout.
    job=app.Job('generate',{'view':'agent','project':'https://flow.google.com/project/same'},'flow',[])
    job.log('FAILED at generate_refs: timeout')
    record=dict(id=job.id,action='generate',payload=job.payload,status='failed',operation_index=0,operation_phases={'0':'clips'},operations=[['mcp',['batch_pipeline',{'generate':True,'stories':['same.json']}]]])
    retry=app.retry_plan(record)[0][1][1]
    assert retry['start_phase']=='clips' and not retry['generate_refs']
print('PASS: all resumable workflow steps retry unfamiliar failures until success; stale reference errors cannot rewind clip progress.')
