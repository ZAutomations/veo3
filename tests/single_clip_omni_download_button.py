import ast,json,os,tempfile,time
from pathlib import Path
from types import SimpleNamespace
source=Path('veo3_gui.py').read_text(encoding='utf-8')
tree=ast.parse(source)
method=next(n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name=='download_omni_clips')
with tempfile.TemporaryDirectory(prefix='omni-download-button-') as folder:
    launched=[]
    def unexpected(*args):raise AssertionError(args)
    context={'os':os,'json':json,'time':time,'BASE_DIR':folder,'messagebox':SimpleNamespace(showwarning=unexpected,showerror=unexpected)}
    exec(compile(ast.Module(body=[method],type_ignores=[]),'button-test','exec'),context)
    app=SimpleNamespace(_work_busy=lambda:False,omni_request=lambda:{'project':'https://flow.google.com/project/test','download':False,'newProject':True,'genRefs':True},
        collect_inputs=lambda:None,save_settings=lambda:None,_ensure_active_browser=lambda:True,settings={'cdp_port':9233},
        _launch=lambda cmd,msg:launched.append((cmd,msg)))
    context['download_omni_clips'](app)
    cmd,msg=launched[0]
    assert Path(cmd[1]).name=='single_clip_omni.js'
    request=json.loads(Path(cmd[2]).read_text())
    assert request['downloadOnly'] is True
    assert request['newProject'] is False and request['genRefs'] is False and request['reuseRefs'] is True
    assert request['cdp']==9233
    assert 'Upscaled 720p' in msg
print('PASS: manual Download button always uses the Upscaled-only runner, even with automatic downloads unchecked; no generation/reference preparation requested.')
