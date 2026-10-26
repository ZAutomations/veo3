import pathlib,sys,tempfile
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import desktop_app as app
with tempfile.TemporaryDirectory() as tmp,patch.object(app,'ROOT',pathlib.Path(tmp)):
 for marker in ['FLOW_REVIEW_REQUIRED:','RECOVERY_REVIEW_REQUIRED:']:
  job=app.Job('generate',{'view':'agent'},'flow',[('cli',['node','agent_mode.js'])])
  calls=[]
  def perform():
   calls.append(1)
   job.log(marker+' blocked or uncertain; successful clips preserved')
   raise RuntimeError('Workflow reported error')
  with patch.object(job,'_run_operations',perform):job.run()
  assert job.status=='failed' and job.auto_retry_count==0 and len(calls)==1
  assert any('reopening the same project cannot resolve it' in line['text'] for line in job.logs)
print('PASS: terminal refusal and uncertain prior submission stop automatic relaunch; no retry or checkpoint reset.')
