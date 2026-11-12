import sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app

assert app.operation_finishes_video('cli',['node','join_clips.js','clips'])
assert app.operation_finishes_video('cli',['node','veo3_flow_new_ui.js','--join'])
assert app.operation_finishes_video('mcp',('batch_pipeline',{'download':True,'join':True}))
assert app.operation_finishes_video('request',('single_clip_omni.js',{'join':True}))
for script in ('agent_download.js','agent_mode.js','generate_refs.js','account_manager.js'):
    assert not app.operation_finishes_video('cli',['node',script])
assert not app.operation_finishes_video('mcp',('batch_pipeline',{'join':False}))
assert not app.operation_finishes_video('request',('single_clip_omni.js',{'join':True,'refsOnly':True}))

with tempfile.TemporaryDirectory() as tmp,patch.object(app,'ROOT',Path(tmp)),patch.object(app,'editing_python',return_value=sys.executable):
    events=[]
    class Proc:
        fail_join=False
        def __init__(self,args,**kwargs):
            self.script=Path(args[1]).name;events.append(self.script);self.stdout=['Finished.']
        def wait(self):return 2 if self.fail_join and self.script=='join_clips.js' else 0
    operations=[('cli',['node',s]) for s in ('generate_refs.js','agent_mode.js','agent_download.js','join_clips.js')]
    job=app.Job('generate',{'view':'agent'},'flow',operations)
    with patch.object(app.subprocess,'Popen',Proc),patch.object(job,'refresh_flow_credits',side_effect=lambda **kw:events.append(('credits',kw))):
        job._run_operations()
    assert events==['generate_refs.js','agent_mode.js','agent_download.js','join_clips.js',('credits',{'after_merge':True})],events
    events.clear();Proc.fail_join=True
    job=app.Job('generate',{'view':'agent'},'flow',operations)
    with patch.object(app.subprocess,'Popen',Proc),patch.object(job,'refresh_flow_credits') as refresh:
        try:job._run_operations()
        except RuntimeError:pass
        refresh.assert_not_called()
    job=app.Job('download',{'view':'agent'},'flow',[])
    with patch.object(app.subprocess,'run') as run:
        job.refresh_flow_credits()
        run.assert_not_called()
print('PASS: automatic credits read once after successful merge only; refs/generation/download/failure/default calls do not read credits; explicit manual refresh remains separate.')
