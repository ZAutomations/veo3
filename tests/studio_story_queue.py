import json,pathlib,sys,tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import desktop_app as studio

with tempfile.TemporaryDirectory() as folder:
    stories=[]
    for n in range(4):
        path=pathlib.Path(folder)/f'story_{n}_story.json'
        path.write_text(json.dumps({'title':f'Story {n}','scene_seconds':8,'scenes':[{'veo3_prompt':'Prompt'}]*(5+n)}))
        stories.append(str(path))
    inputs={'view':'omni','queue':stories,'model':'Omni 1.1 Flash','resolution':'360p','aspect':'9:16','seconds':8,'cdp':9222,'download':True,'join':True,'batchGenRefs':True}
    lane,ops=studio.plan_action('generate_queue',inputs)
    assert lane=='flow' and len(ops)==4
    for n,(_,(_,req)) in enumerate(ops):
        assert pathlib.Path(req['story']).resolve()==pathlib.Path(stories[n]).resolve() and req['to']==5+n
        assert req['from']==1 and req['newProject'] and req['genRefs']
        assert req['project']=='' and req['download'] and req['join']
    record={'action':'generate_queue','payload':dict(inputs,project='https://flow.google.com/project/last'),'status':'failed','operation_index':1,'operations':ops,'operation_projects':{'1':'https://flow.google.com/project/story-two'}}
    resumed=studio.retry_plan(record)
    assert len(resumed)==3
    assert resumed[0][1][1]['project'].endswith('/story-two') and not resumed[0][1][1]['newProject']
    assert all(op[1][1]['newProject'] and op[1][1]['project']=='' for op in resumed[1:]),'future stories must never share the failed story project'
    for view in ['agent','ingredients']:
        _,other=studio.plan_action('generate_queue',dict(inputs,view=view))
        assert len(other)==4
        retry=studio.retry_plan(dict(record,operations=other))
        assert len(retry)==3
    try:studio.plan_action('generate_queue',dict(inputs,queue=[stories[0],stories[0]]));raise AssertionError('duplicate stories allowed')
    except ValueError:pass
print('PASS: four full-story jobs, own projects and reference preparation, shared video settings, and retry skips earlier stories without mixing projects; all three workflows.')
