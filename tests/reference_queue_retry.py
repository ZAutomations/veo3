import pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import desktop_app as app
record={'action':'generate_queue','status':'failed','payload':{'view':'agent'},'operation_index':1,
 'operation_projects':{'0':'https://flow.google.com/project/first','1':'https://flow.google.com/project/second'},
 'operation_phases':{'0':'clips','1':'refs'},
 'operations':[['mcp',['batch_pipeline',{'stories':['first.json'],'generate':True}]],
               ['mcp',['batch_pipeline',{'stories':['second.json'],'generate':True,'new_project':True}]],
               ['mcp',['batch_pipeline',{'stories':['third.json'],'generate':True,'new_project':True}]]]}
ops=app.retry_plan(record)
assert len(ops)==2
req=ops[0][1][1]
assert req['project_url'].endswith('/second') and not req['new_project']
assert req['start_phase']=='start' and req['generate_refs']
assert ops[1][1][1]['new_project']
record['operation_phases']['1']='clips'
req=app.retry_plan(record)[0][1][1]
assert req['start_phase']=='clips' and not req['generate_refs']
print('PASS: retry failed references in the second project, skip the completed first story, preserve fresh projects for later stories.')
