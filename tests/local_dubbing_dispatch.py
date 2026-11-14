import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as A,local_dubbing as L
p={'view':'settings','localDubFolder':'D:/translated','multilingualMode':'multiple','multilingualEnabled':True,'multiLang_ur':True,'multiProvider_ur':'google','multiVoice_ur':'Alnilam'}
with patch.object(L,'plan',return_value={'jobs':[]}):
 lane,ops=A.plan_action('render_local_multilingual',p)
assert lane=='flow' and len(ops)==1 and ops[0][0]=='request' and ops[0][1][0]=='local_dubbing.py'
body=ops[0][1][1];assert body['folder']=='D:/translated' and body['multilingual']['languages']==[{'code':'ur','provider':'google','voice':'Alnilam'}]
assert 'render_local_multilingual' in A.RETRY_ACTIONS
print('PASS: local UI action schedules only local_dubbing.py with selected profiles; no English preparation, browser or Veo operation.')
