"""Provided translations never invoke a writer/translator."""
import copy,json,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import multilingual as M
import audio_first as A
root=Path(__file__).resolve().parents[1]
import subprocess
built=subprocess.run(['node','-e',"const fs=require('fs'),I=require('./import_ready_script');const s=I.parse(fs.readFileSync('samples/multilingual/ocean_nuclear_30s/READY_IMPORT_4_LANGUAGES.txt','utf8'))[0];process.stdout.write(JSON.stringify(I.prepare(s,'9:16').story));"],cwd=root,capture_output=True,text=True,encoding='utf-8',check=True)
original=json.loads(built.stdout)
assert original['narration_languages']==['en','ru','ar','hi'] and len(original['scenes'])==3
assert all(set(s['narration_translations'])=={'en','ru','ar','hi'} for s in original['scenes'])
cfg={'enabled':True,'languages':[dict(code=code,provider='heygen',voice='test') for code in ('ru','ar','hi')]}
with tempfile.TemporaryDirectory() as tmp:
 file=Path(tmp)/'original_story.json';file.write_text(json.dumps(original,ensure_ascii=False),encoding='utf-8')
 planned=A.plan_package(dict(story=str(file),multilingual=cfg,editingSettings=dict(voiceover_mode='api',voiceover_provider='heygen',voiceover_voice='test')))
 assert len(planned['selected'])==3
 package=copy.deepcopy(original);package['audio_first']=True
 for scene in package['scenes']:scene['external_narration']=scene['script_line']
 prepared=Path(tmp)/'prepared_story.json';prepared.write_text(json.dumps(package,ensure_ascii=False),encoding='utf-8')
 with patch.object(M,'translation',side_effect=AssertionError('No Gemini call allowed for supplied scripts')):
  output=M.prepare_scripts(prepared,cfg)
  for code in ('ru','ar','hi'):
   assert json.loads((output/(code+'_script.json')).read_text(encoding='utf-8'))==[s['narration_translations'][code] for s in original['scenes']]
  try:M.prepare_scripts(prepared,dict(enabled=True,languages=[dict(code='fr',provider='heygen',voice='test')]))
  except ValueError as e:assert 'Missing supplied' in str(e)
  else:raise AssertionError('Missing language silently translated')
print('PASS: actual imported four-language sample preserves every supplied scene; all three target scripts bypass translation; missing language fails before paid generation.')
