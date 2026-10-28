import json,pathlib,sys,tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import desktop_app as app
with tempfile.TemporaryDirectory() as folder:
    story=pathlib.Path(folder)/'sample_story.json'
    story.write_text(json.dumps({'title':'Sample','scene_seconds':8,'scenes':[{'veo3_prompt':'test'}]}))
    base={'usePresetRefs':False,'view':'agent','queue':[str(story)],'model':'Omni 1.1 Flash','aspect':'9:16','seconds':8,'resolution':'360p'}
    for general,batch,expected in [(True,False,True),(False,True,True),(False,False,False),(True,True,True)]:
        _,ops=app.plan_action('generate_queue',dict(base,genRefs=general,batchGenRefs=batch))
        assert ops[0][1][1]['generate_refs']==expected,(general,batch)
    old={'stories':[str(story)],'generate':True,'submit':True,'new_project':True,'generate_refs':False}
    rec={'action':'generate_queue','status':'failed','payload':dict(base,genRefs=True,batchGenRefs=False),'operations':[['mcp',['batch_pipeline',old]],['mcp',['batch_pipeline',old]]],'operation_index':0,'operation_projects':{'0':'https://flow.google.com/project/existing'},'operation_phases':{'0':'clips'}}
    retry=app.retry_plan(rec)
    assert retry[0][1][1]['generate_refs'] and retry[0][1][1]['start_phase']=='start'
    assert not retry[0][1][1]['new_project']
    assert retry[1][1][1]['generate_refs'] and retry[1][1][1]['new_project']
    rec['operations']=retry;rec['operation_phases']['0']='clips'
    retry2=app.retry_plan(rec)
    assert not retry2[0][1][1]['generate_refs'] and retry2[0][1][1]['start_phase']=='clips'
print('PASS: either enabled reference switch prepares refs, both off remains explicit; old skipped queue repaired in same project, future stories prepared, completed preparation not repeated.')
