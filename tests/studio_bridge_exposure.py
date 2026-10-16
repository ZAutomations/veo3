"""Exercise installed pywebview's actual JS bridge scanner, without opening a GUI."""
import json,sys,threading,types
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from desktop_app import DesktopBridge
from webview import util
class NativeSentinel:
    def __dir__(self):raise AssertionError('Native window must never be recursively exposed to Javascript')
class Event:
    def __init__(self):self.calls=0
    def set(self):self.calls+=1
class InlineThread:
    def __init__(self,target):self.target=target
    def start(self):self.target()
bridge=DesktopBridge('http://127.0.0.1:1234')
bridge._window=NativeSentinel();bridge._writer_window=NativeSentinel()
assert set(n for n in dir(bridge) if not n.startswith('_'))=={'choose_file','open_story_folder','open_legacy','open_story_writer'}
scripts=[]
window=types.SimpleNamespace(_js_api=bridge,_functions={},_expose_lock=threading.Lock(),run_js=scripts.append,
    events=types.SimpleNamespace(before_load=Event(),loaded=Event(),_pywebviewready=Event()))
with patch.object(util,'load_js_files',return_value=('bootstrap','%(functions)s')),patch.object(util,'Thread',InlineThread),patch.object(util.logger,'error') as errors,patch.object(util.logger,'exception') as exceptions:
    util.inject_pywebview('edgechromium',window)
    assert not errors.called and not exceptions.called
assert window.events.loaded.calls==1 and window.events._pywebviewready.calls==1
functions=json.loads(scripts[-1]);assert {f['func'] for f in functions}=={'choose_file','open_story_folder','open_legacy','open_story_writer'}
print('PASS: installed pywebview exposes only four intended bridge methods; native main/writer window objects remain private and cannot recurse.')
