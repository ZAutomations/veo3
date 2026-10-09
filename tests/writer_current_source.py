import ast
import json
import pathlib
import tempfile
import types

root = pathlib.Path(__file__).resolve().parent.parent
tree = ast.parse((root / 'veo3_gui.py').read_text(encoding='utf-8'))
method = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'retry_story_writing')
with tempfile.TemporaryDirectory() as tmp:
    file = pathlib.Path(tmp) / 'job.json'
    old = 'https://www.youtube.com/shorts/AuOTD2ebghM'
    new = 'https://www.youtube.com/shorts/PwmHomYliKI'
    file.write_text(json.dumps({'kind':'batch','transport':'web','args':{'references':[old]}}))
    calls = []
    obj = types.SimpleNamespace(_work_busy=lambda:False,writer_job_file=str(file),
        script_batch_request=lambda:{'references':[new]},_console=lambda _:None,
        write_script_batch=lambda:calls.append('current'),_aistudio_ready=lambda:True,
        stop_mcp=lambda:None,start_workflow_worker=lambda args:calls.append(args))
    scope = {'json':json,'messagebox':None}
    exec(compile(ast.Module(body=[method],type_ignores=[]),'retry-test','exec'),scope)
    scope['retry_story_writing'](obj)
    assert calls == ['current'], calls
    calls.clear()
    obj.script_batch_request = lambda:{'references':[old]}
    scope['retry_story_writing'](obj)
    assert len(calls)==1 and calls[0]['references']==[old]
print('PASS: changed video starts current request; unchanged video resumes saved progress.')
