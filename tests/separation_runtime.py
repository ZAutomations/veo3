import sys,tempfile,subprocess
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import speech_background as S
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp)/'Veo3';root.mkdir()
    shared=Path(tmp)/'VideoAuotmation/setup/dub_venv/Scripts/python.exe';shared.parent.mkdir(parents=True);shared.touch()
    custom=Path(tmp)/'custom.exe';custom.touch()
    calls=[]
    def probe(args,**kwargs):
        calls.append(args[0]);return subprocess.CompletedProcess(args,0 if Path(args[0])==shared else 1,'ready','')
    with patch.object(S.E,'ROOT',root),patch.object(S.subprocess,'run',side_effect=probe),patch.dict(S.os.environ,{'VEO_SEPARATION_PYTHON':''}):
        assert Path(S.resolve_python())==shared
        assert all('import demucs,torch,numpy,soundfile' in c.args[0][2] for c in S.subprocess.run.call_args_list)
    def configured(args,**kwargs):return subprocess.CompletedProcess(args,0,'ready','')
    with patch.object(S.subprocess,'run',side_effect=configured):assert S.resolve_python(str(custom))==str(custom)
print('PASS: configured interpreter wins; shared portable Demucs runtime is discovered and import-verified without installing packages.')
