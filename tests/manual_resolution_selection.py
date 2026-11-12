import sys,tempfile,json,os
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as D
with tempfile.TemporaryDirectory() as tmp,patch.object(D,'ROOT',Path(tmp)):
    p=dict(view='writer',preset='3d-zack-style',readyScript='Story 1',manualResolution='1080p')
    with patch.object(D,'presets',return_value=[{'id':'3d-zack-style'}]):
        _,ops=D.plan_action('import_script',p)
    assert ops[0][1][1]['videoResolution']=='1080p'
    job=D.Job('write',p,'writer',[])
    with patch.object(D,'editing_python',return_value=sys.executable):
        assert job.reference_environment()['VEO_MANUAL_RESOLUTION']=='1080p'
    flow=D.Job('generate',dict(p,view='agent'),'flow',[])
    with patch.object(D,'editing_python',return_value=sys.executable),patch.dict(os.environ,{'VEO_MANUAL_RESOLUTION':'1080p'}):
        assert 'VEO_MANUAL_RESOLUTION' not in flow.reference_environment()
    for value in ['240p','4K',1080]:
        try:D.manual_batch_resolution({'manualResolution':value})
        except ValueError:pass
        else:raise AssertionError('Unsupported value accepted')
print('PASS: writer selection reaches importer and writing subprocesses; automatic generation stays independent; invalid choices rejected.')
