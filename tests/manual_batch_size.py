import sys,tempfile,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
with tempfile.TemporaryDirectory() as tmp:
    path=Path(tmp)/'story.json';path.write_text(json.dumps(dict(title='Batch test',scenes=[dict(veo3_prompt='Test') for _ in range(13)])))
    inputs=dict(story=str(path),view='agent',project='https://flow.google.com/project/test',model='Omni 1.1 Flash',resolution='360p',aspect='9:16',cdp=9222,usePresetRefs=False,selectionType='batch',selection='5',manualBatchSize=3)
    _,ops=app.plan_action('manual',inputs);args=ops[-1][1]
    assert args[args.index('--batch-size')+1]=='3'
    assert args[args.index('--batch')+1]=='5'
    for patch in [dict(manualBatchSize=0),dict(manualBatchSize=2.5),dict(selection='6')]:
        try:app.plan_action('manual',dict(inputs,**patch))
        except ValueError:pass
        else:raise AssertionError(patch)
    _,ops=app.plan_action('manual',dict(inputs,selection='3',manualBatchSize=5));args=ops[-1][1];assert args[args.index('--batch-size')+1]=='5'
print('PASS: Studio validates custom batch size and forwards it to manual Agent runner.')


with tempfile.TemporaryDirectory() as tmp:
    path=Path(tmp)/'story.json';path.write_text(json.dumps(dict(title='Batch test',scenes=[dict(veo3_prompt='Test') for _ in range(20)])))
    inputs=dict(story=str(path),view='agent',project='https://flow.google.com/project/test',model='Omni 1.1 Flash',resolution='360p',aspect='9:16',cdp=9222,usePresetRefs=False,manualBatchSize=8,download=False,join=False)
    _,ops=app.plan_action('generate',inputs)
    driver=next(args for kind,args in ops if kind=='cli' and any('agent_batch_run.js' in str(x) for x in args))
    assert driver[driver.index('--batch-size')+1]=='8'
    _,ops=app.plan_action('generate',dict(inputs,newProject=True))
    assert ops[0][1][1]['clip_batch_size']==8
print('PASS: custom eight reaches normal CLI and new-project pipeline.')
