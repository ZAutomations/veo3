import json,sys,tempfile,types
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
with tempfile.TemporaryDirectory() as folder:
    main=Path(folder)/'main.json';writer=Path(folder)/'writer.json'
    initial={'current':'omni','theme':'ember','forms':{'writer':{'ideas':'Draft'},'omni':{'project':'keep-this'}}}
    main.write_text(json.dumps(initial))
    with patch.object(app,'STATE',main),patch.object(app,'WRITER_STATE',writer):
        prefs=app.surface_preferences('writer')
        assert prefs['current']=='writer' and prefs['theme']=='ember'
        assert prefs['forms']['writer']['ideas']=='Draft'
        app.preferences({'current':'writer','theme':'matte','forms':{'writer':{'ideas':'New draft'}}},'writer')
        assert json.loads(main.read_text())==initial
        assert app.surface_preferences('writer')['forms']['writer']['ideas']=='New draft'
        assert app.surface_preferences('studio')['forms']['omni']['project']=='keep-this'
        assert app.bootstrap('writer')['preferences']['current']=='writer'
        assert app.bootstrap('studio')['preferences']['current']=='omni'
        class Event:
            def __init__(self):self.callbacks=[]
            def __iadd__(self,callback):self.callbacks.append(callback);return self
        class Window:
            def __init__(self):self.events=types.SimpleNamespace(closed=Event());self.show_count=0;self.restore_count=0
            def show(self):self.show_count+=1
            def restore(self):self.restore_count+=1
            def create_file_dialog(self,*args,**kwargs):return ['writer-selected.json']
        windows=[];calls=[]
        def create(*args,**kwargs):
            w=Window();windows.append(w);calls.append((args,kwargs));return w
        fake=types.SimpleNamespace(create_window=create,windows=[Window()],FileDialog=types.SimpleNamespace(OPEN=1))
        with patch.dict(sys.modules,webview=fake):
            bridge=app.DesktopBridge('http://127.0.0.1:1234')
            assert bridge.open_story_writer()
            assert calls[0][0][1]=='http://127.0.0.1:1234/?writer=1'
            child=calls[0][1]['js_api'];assert child._window is windows[0]
            assert child.choose_file()=='writer-selected.json'
            assert bridge.open_story_writer() and len(windows)==1
            assert windows[0].show_count==1 and windows[0].restore_count==1
            for callback in windows[0].events.closed.callbacks:callback()
            assert bridge._writer_window is None
            assert bridge.open_story_writer() and len(windows)==2
print('PASS: separate Studio writer window, own settings/file dialogs, existing-window reuse and reopen; no app launch or generation.')
