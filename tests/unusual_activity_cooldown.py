import sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
class Delay:
    def __init__(self):self.calls=[]
    def wait(self,n):self.calls.append(n);return False
with tempfile.TemporaryDirectory() as tmp,patch.object(app,'ROOT',Path(tmp)):
    for message,fails,status,expected in [
        ('FLOW_UNUSUAL_ACTIVITY: We noticed some unusual activity.',99,'failed',[60,60]),
        ('We noticed some unusual activity.',1,'completed',[60]),
        ('UNUSUAL_ACTIVITY_BLOCKED: reference already attempted three times',99,'failed',[]),
        ('Temporary download interruption',1,'completed',[8]),
    ]:
        job=app.Job('generate',{'view':'agent'},'flow',[('cli',['node','agent_mode.js'])]);delay=Delay();job._stop_event=delay;calls=[]
        def perform():
            calls.append(1)
            if len(calls)<=fails:raise RuntimeError(message)
        with patch.object(job,'_run_operations',perform):job.run()
        assert job.status==status,list(job.logs)
        assert delay.calls==expected,delay.calls
        assert len(calls)==len(expected)+1
        assert not any('account_manager' in str(o) for o in job.operations)
print('PASS: unusual activity waits 60s, stops on third failure, already-exhausted refs stop immediately, ordinary errors retain 8s, no account rotation.')
