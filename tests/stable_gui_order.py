import ast
import json
import os
import pathlib
import re
import tempfile
import types

ROOT = pathlib.Path(__file__).resolve().parent.parent
tree = ast.parse((ROOT / 'veo3_gui.py').read_text(encoding='utf-8'))
method = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'join_clips')

class Messages:
    def __init__(self): self.errors = []
    def showerror(self, *args): self.errors.append(args)
    def askyesno(self, *args): raise AssertionError('Join must not offer a filename-order override')

with tempfile.TemporaryDirectory() as tmp:
    directory = pathlib.Path(tmp)
    for n in range(1, 3): (directory / f'scene-{n:02d}.mp4').touch()
    manifest = {'expected': 2, 'complete': True, 'clips': [
        {'file': 'scene-02.mp4', 'got': True}, {'file': 'scene-01.mp4', 'got': True}]}
    messages = Messages()
    namespace = {'os': os, 're': re, 'json': json, 'JOINER': 'join_clips.js', 'messagebox': messages}
    exec(compile(ast.Module(body=[method], type_ignores=[]), 'join-test', 'exec'), namespace)
    launched = []
    gui = types.SimpleNamespace(collect_inputs=lambda: None, correct_clips_dir=lambda _: tmp,
        save_settings=lambda: None, _launch=lambda cmd, msg: launched.append(cmd))
    (directory / 'manifest.json').write_text(json.dumps(manifest))
    namespace['join_clips'](gui)
    assert launched == [['node', 'join_clips.js', tmp]], launched
    launched.clear()
    manifest['complete'] = False
    (directory / 'manifest.json').write_text(json.dumps(manifest))
    namespace['join_clips'](gui)
    assert not launched and messages.errors
print('PASS: resolved manifest order preserved; uncertain mapping cannot become filename order.')
