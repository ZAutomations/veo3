"""Saved multilingual profiles and Audio First worker planning, without API calls."""
import json,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
import audio_first as A
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);folder=root/'stories'/'fixture';folder.mkdir(parents=True);file=folder/'test_story.json'
    file.write_text(json.dumps(dict(title='Fixture',narrated=True,scene_seconds=8,scenes=[dict(script_line='A complete spoken explanation.')])))
    form=dict(multilingualEnabled=True,multiLang_ru=True,multiProvider_ru='heygen',multiVoice_ru='saved-voice')
    with patch.object(app,'ROOT',root):
        app.settings(form)
        saved=json.loads((root/'gui_settings.json').read_text())['multilingual'];assert saved['languages'][0]['voice']=='saved-voice'
        lane,steps=app.plan_action('prepare_audio_first',dict(view='agent',story=str(file)))
        assert lane=='writer' and steps[0][1][1]['multilingual']==saved
        # Multilingual settings isolate new packages and do not affect Native imports.
        cfg=dict(voiceover_mode='api',voiceover_provider='heygen',voiceover_voice='english')
        normal=A.plan_package(dict(story=str(file),editingSettings=cfg));multi=A.plan_package(dict(story=str(file),editingSettings=cfg,multilingual=saved))
        assert normal['file']!=multi['file'] and not normal['multilingual']['enabled']
        lane,steps=app.plan_action('render_multilingual',dict(story=str(file),**form))
        assert lane=='flow' and steps[0][1][0]=='multilingual.py' and steps[0][1][1]['multilingual']==saved
print('PASS: saved voice/language settings survive reload; new Audio First packages are isolated and existing-English jobs are allowlisted; no network calls.')

# Translation connection failures are retryable, but invalid output needs review.
import multilingual as M
import subprocess
from types import SimpleNamespace
with tempfile.TemporaryDirectory() as tmp:
 out=Path(tmp)/'ru.json'
 with patch.object(M.subprocess,'run',return_value=SimpleNamespace(returncode=75)):
  try:M.translation(['English source.'],'ru',9.5,out)
  except M.TranslationNetworkError:pass
  else:raise AssertionError('Network failure was not classified as transient')
 with patch.object(M.subprocess,'run',side_effect=subprocess.TimeoutExpired('node',180)):
  try:M.translation(['English source.'],'ru',9.5,out)
  except M.TranslationNetworkError:pass
  else:raise AssertionError('Translation timeout was not bounded')
 with patch.object(M.subprocess,'run',return_value=SimpleNamespace(returncode=1)):
  try:M.translation(['English source.'],'ru',9.5,out)
  except M.TranslationNetworkError:raise AssertionError('Invalid translation must not become a network retry')
  except ValueError:pass
  else:raise AssertionError('Invalid translation accepted')
print('PASS: translation network errors/timeouts retry without a review marker; validation failures still require correction.')

assert M.from_form(dict(multilingualMode='english',multilingualEnabled=True,multiLang_ja=True,multiVoice_ja='unused'))==dict(enabled=False,languages=[])
ja=M.from_form(dict(multilingualMode='multiple',multiLang_ja=True,multiProvider_ja='heygen',multiVoice_ja='japanese-voice'))
assert ja['languages']==[dict(code='ja',provider='heygen',voice='japanese-voice')]
print('PASS: English-only mode ignores stale additional-language selections; Japanese voice selection is valid.')
