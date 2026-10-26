import re,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
with tempfile.TemporaryDirectory() as tmp,patch.object(app,'ROOT',Path(tmp)):
    job=app.Job('download',{'view':'agent'},'flow',[])
    job.log('Batch summary\nFAILED at download_clips: timeout\n\nRetry / Continue in 8 seconds.')
    assert len(job.logs)==4
    assert all(re.match(r'^\[\d{2}:\d{2}:\d{2}\]', row['text']) for row in job.logs)
    assert 'FAILED at download_clips' in job.logs[1]['text']
    disk=(Path(tmp)/'logs'/'desktop'/(job.id+'.log')).read_text().splitlines()
    assert disk==[row['text'] for row in job.logs]
    assert job.sequence==4 and len({row['id'] for row in job.logs})==4
    job.run()
    assert job.status=='completed' and job.logs[-1]['text'].endswith('Workflow completed successfully.')
print('PASS: multiline summaries, failed steps, retry messages, blank lines and final status all have matching UI/file timestamps.')
