"""Actual language timing must pass before video production is released."""
import json,sys,tempfile,shutil,hashlib
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import multilingual as M
import audio_first as A
import video_editing as E
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);short=root/'short.wav';long=root/'long.wav'
 for file,seconds in [(short,1),(long,14.0)]:E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'sine=duration={seconds}',file])
 source=root/'original_story.json';source.write_text(json.dumps(dict(title='Preflight',narrated=True,scene_seconds=10,multilingual_translation_mode='supplied_only',scenes=[dict(script_line='What happens if a nuclear bomb falls into the ocean? A fall alone does not cause nuclear detonation. If it exploded underwater, a powerful pressure wave would spread.',narration_translations={'en':'English','ru':'Too long supplied narration.'})])))
 cfg={'enabled':True,'languages':[dict(code='ru',provider='heygen',voice='ru')]}
 body=dict(story=str(source),multilingual=cfg,editingSettings=dict(voiceover_mode='api',voiceover_provider='heygen',voiceover_voice='english'))
 target=A.plan_package(body)['file'];calls=[];realrun=E.run
 def synth(provider,voice,text,dest):
  if not Path(dest).exists():calls.append((voice,text));shutil.copy2(long if voice=='ru' and text!='Short corrected narration.' else short,dest)
  return Path(dest)
 def run(command,*args,**kwargs):
  assert str(command[0])!='node','No prompt export/Flow stage may run after failed narration preflight'
  return realrun(command,*args,**kwargs)
 with patch.object(M,'translation',side_effect=AssertionError('No Gemini')),patch.object(A.C,'calibrate',return_value=None),patch.object(A.V,'synthesize',synth),patch.object(E,'run',run):
  try:A.prepare(body)
  except ValueError as e:assert 'supplied narration' in str(e)
  else:raise AssertionError('Overlong supplied speech allowed video production')
 assert target.exists() and len(calls)==2
 stage=next((target.parent/'multilingual').glob('*'));assert not (stage/'AUDIO_PREFLIGHT_READY.json').exists();assert (stage/'ru/TIMING_REPAIR.json').exists()
 original=target.read_bytes();M.atomic(target.parent/'multilingual_narration_overrides.json',dict(story_sha256=hashlib.sha256(original).hexdigest(),narrations={'ru':{'1':'Short corrected narration.'}}))
 with patch.object(M,'translation',side_effect=AssertionError('No Gemini')),patch.object(A.V,'synthesize',synth),patch.object(E,'edit',side_effect=AssertionError('Preflight must not render video')):
  ready=M.preflight_audio(target,cfg);assert (ready/'AUDIO_PREFLIGHT_READY.json').exists()
 assert target.read_bytes()==original,'Voice repair must not change the original story or its Flow checkpoint'
 assert len(calls)==3,'Only the changed language line requests new speech'
print('PASS: overlong language blocks before prompt/video release; repair is story-bound, no Gemini, cached audio retained, changed line alone synthesized, success marker only after actual timing passes.')
