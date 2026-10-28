import sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
class Delay:
    def __init__(self):self.calls=[]
    def wait(self,n):self.calls.append(n);return False
with tempfile.TemporaryDirectory() as tmp,patch.object(app,'ROOT',Path(tmp)):
    for error,failures,expected,delays in [
        ('RECOVERY_REVIEW_REQUIRED: IMPORT_VALIDATION_FAILED\nStory: 141\nLine: 12',99,'failed',[]),
        ('Temporary file lock',99,'failed',[8,16,32]),
        ('Temporary file lock',2,'completed',[8,16]),
    ]:
        job=app.Job('import_script',{'view':'writer'},'writer',[('cli',['node','import_ready_script.js'])])
        delay=Delay();job._stop_event=delay;calls=[]
        def perform():
            calls.append(1)
            if len(calls)<=failures:raise RuntimeError(error)
        with patch.object(job,'_run_operations',perform):job.run()
        assert job.status==expected,list(job.logs)
        assert delay.calls==delays,delay.calls
        assert len(calls)==len(delays)+1
print('PASS: import validation stops immediately; transient import failures use bounded 8/16/32-second retries and can recover.')
