import sys,json,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app

ERROR='FAILED at download_clips: FAILED: Scene 4: Flow did not start the upscaled download within 90 seconds. DOWNLOAD FAILED: 0/? playable clips saved; 0 transfers failed.'
assert app.automatic_retry_allowed('generate','flow')
assert app.automatic_retry_allowed('generate_queue','flow')
assert app.automatic_retry_allowed('download','flow')
assert app.automatic_retry_allowed('write','writer')
assert not app.automatic_retry_allowed('manual','flow')
assert not app.automatic_retry_allowed('delete','flow')
class Wait:
    def __init__(self,job,stop=False):self.job=job;self.calls=[];self.stop=stop
    def wait(self,seconds):
        self.calls.append(seconds)
        assert self.job.status=='running','retry delay must retain the active lane'
        if self.stop:self.job.stopped=True;return True
        return False
    def set(self):pass

with tempfile.TemporaryDirectory() as tmp,patch.object(app,'ROOT',Path(tmp)):
    counts={};runs=[]
    class Proc:
        def __init__(self,spec,**kwargs):
            self.name=Path(spec[1]).name;runs.append(self.name);counts[self.name]=counts.get(self.name,0)+1
            self.code=1 if self.name=='agent_download.js' and counts[self.name]<3 else 0
            self.stdout=[ERROR] if self.code else ['Download finished.' if self.name=='agent_download.js' else 'Done.']
        def wait(self):return self.code
    with patch.object(app.subprocess,'Popen',Proc):
        job=app.Job('generate',{'view':'agent','project':'https://flow.google.com/project/same'},'flow',[('cli',['node','already_done.js']),('cli',['node','agent_download.js']),('cli',['node','join_clips.js'])])
        delay=Wait(job);job._stop_event=delay;job.run()
    assert job.status=='completed' and job.auto_retry_count==2
    assert runs==['already_done.js','agent_download.js','agent_download.js','agent_download.js','join_clips.js'],runs
    assert delay.calls==[8,8]
    # A persistent transfer failure keeps retrying until Stop cancels the wait.
    job=app.Job('download',{'view':'agent'},'flow',[('cli',['node','agent_download.js'])])
    delay=Wait(job,stop=True);job._stop_event=delay;counts['agent_download.js']=0
    with patch.object(app.subprocess,'Popen',Proc):job.run()
    assert job.status=='stopped' and job.auto_retry_count==1
    # Batch resume retains the failed story project and leaves the next new project untouched.
    calls=[];failure_count=0
    class Client:
        def __init__(self,*args,log,**kwargs):self.log=log
        def start(self):pass
        def stop(self):pass
        def call_tool(self,name,args):
            global failure_count
            title=args['stories'][0];calls.append((title,dict(args)))
            project={'first':'one','second':'two','third':'three'}[title]
            self.log('project -> https://flow.google.com/project/'+project)
            if title=='second' and failure_count<2:
                failure_count+=1;self.log(ERROR);return {'text':ERROR,'isError':True}
            return {'text':'Done','isError':False}
    operations=[('mcp',('batch_pipeline',dict(stories=[title],generate=True,new_project=True,generate_refs=True,start_phase='start'))) for title in ['first','second','third']]
    job=app.Job('generate_queue',{'view':'agent'},'flow',operations);job._stop_event=Wait(job)
    with patch.object(app,'MCPClient',Client):job.run()
    assert job.status=='completed',list(job.logs)
    assert [title for title,args in calls]==['first','second','second','second','third']
    for title,args in calls[2:4]:
        assert args['project_url'].endswith('/two') and not args['new_project'] and not args['generate_refs']
    assert calls[-1][1]['new_project'] and 'project_url' not in calls[-1][1]
    assert job.auto_retry_count==2
    # Reference timeout must recover reference preparation in the failed project.
    ERROR='FAILED at generate_refs: FAILED: No completed reference image after 180s.'
    assert app.automatic_retry_allowed('generate_queue','flow')
    assert app.automatic_retry_allowed('refs','flow')
    calls.clear();failure_count=0
    job=app.Job('generate_queue',{'view':'agent'},'flow',operations);job._stop_event=Wait(job)
    with patch.object(app,'MCPClient',Client):job.run()
    assert job.status=='completed' and job.auto_retry_count==2
    assert [title for title,args in calls]==['first','second','second','second','third']
    for title,args in calls[2:4]:
        assert args['project_url'].endswith('/two') and args['generate_refs'] and args['start_phase']=='start'
        assert not args['new_project']
    assert calls[-1][1]['new_project']
    # Any failure is retried until the user stops recovery.
    def bad():job.log('Project not found');raise RuntimeError('Access denied')
    job=app.Job('generate',{'view':'agent'},'flow',[('cli',['node','x.js'])]);job._stop_event=Wait(job,stop=True)
    job.log(ERROR)
    with patch.object(job,'_run_operations',bad):job.run()
    assert job.status=='stopped' and job.auto_retry_count==1
print('PASS: automatic eight-second transfer recovery, repeated failures, Stop cancellation, completed-step skipping, correct single/batch project resume and any-step retry cancellation; no real browser or generation.')
