import sys,tempfile,json
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
with tempfile.TemporaryDirectory() as tmp,patch.object(app,'ROOT',Path(tmp)):
    app.save_json(Path(tmp)/'gui_settings.json',dict(workflow_globals=dict(rotateQueueAccounts=True,videosPerAccount=2,activityCooldownSeconds=90)))
    cfg=app.global_workflow_settings();assert cfg['rotateQueueAccounts'] and cfg['activityCooldownSeconds']==90
    payload=app.global_workflow_payload(dict(rotateQueueAccounts=False,videosPerAccount=8));assert payload['rotateQueueAccounts'] and payload['videosPerAccount']==2
    app.save_json(Path(tmp)/'gui_settings.json',dict(workflow_globals=dict(rotateQueueAccounts=False)))
    assert app.global_workflow_payload(payload)['rotateQueueAccounts'],'Existing snapshot must remain unchanged'
    assert not app.global_workflow_payload({})['rotateQueueAccounts']
    class Delay:
        def __init__(self):self.calls=[]
        def wait(self,n):self.calls.append(n);return False
    for enabled,expected in [(True,[90,90]),(False,[])]:
        job=app.Job('generate',dict(view='agent',_globalWorkflow=app.global_workflow_settings(dict(activityCooldownEnabled=enabled,activityCooldownSeconds=90))), 'flow',[('cli',['node','agent_mode.js'])]);delay=Delay();job._stop_event=delay
        with patch.object(job,'_run_operations',side_effect=RuntimeError('FLOW_UNUSUAL_ACTIVITY: unusual activity')):job.run()
        assert delay.calls==expected,delay.calls
    for value in [dict(activityMaxAttempts=4),dict(activityCooldownSeconds=8),dict(rotateQueueAccounts='yes')]:
        try:app.global_workflow_settings(value)
        except ValueError:pass
        else:raise AssertionError(value)
print('PASS: shared saved settings override stale mode fields; job snapshots survive edits; cooldown 90s and disabled immediate-stop work; invalid policies rejected.')

video=app.global_workflow_settings(dict(videoModel='Omni 1.1 Flash',videoAspect='16:9',videoResolution='720p',videoSeconds=8,automationCdp=9333,agentPromptsPerBatch=8))
resolved=app.global_workflow_payload(dict(view='agent',model='stale model',resolution='360p',_globalWorkflow=video))
assert resolved['model']=='Omni 1.1 Flash' and resolved['resolution']=='720p' and resolved['cdp']==9333 and resolved['manualBatchSize']==8
writer=app.global_workflow_payload(dict(view='writer',seconds=6,_globalWorkflow=video));assert writer['seconds']==6
print('PASS: shared video settings override stale generation forms and leave story-writing duration untouched.')
