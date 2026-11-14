"""Offline local-only batch/media check: never uses Veo, translation, or real TTS."""
import copy,json,tempfile,sys,shutil,hashlib
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import local_dubbing as L,video_editing as E,voiceover as V,multilingual as M,speech_background as S
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);project=root/'stories/preset/original';project.mkdir(parents=True);scripts=root/'scripts';scripts.mkdir()
 original=project/'original_story.json';story={'title':'Local Fixture','preset_id':'science-what-if','scene_seconds':4,'scenes':[{'script_line':'First exact English line.'},{'script_line':'Second exact English line.'}]};original.write_text(json.dumps(story))
 raw=project/'Local Fixture raw.mp4';english=project/'Local Fixture.mp4'
 E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=blue:s=64x96:r=10:d=10','-f','lavfi','-i','sine=frequency=100:duration=10','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',raw]);shutil.copy2(raw,english)
 before=hashlib.sha256(english.read_bytes()).hexdigest()
 (project/'JOINED_CLIP_ORDER.txt').write_text(f'Completed video: {raw.resolve()}\n01 | 0.00s | scene1\n02 | 4.00s | scene2\n03 | 8.00s | thumb (thumbnail end card)\n')
 translated=copy.deepcopy(story)
 for i,s in enumerate(translated['scenes']):s['narration_translations']={'en':s['script_line'],'ur':'اردو عبارت '+str(i),'ja':'日本語の説明。'+str(i)}
 (scripts/'translated_story.json').write_text(json.dumps(translated,ensure_ascii=False),encoding='utf-8')
 # English-only files in the same selected folder must not become dubbing jobs.
 (scripts/'original_only_story.json').write_text(json.dumps(story))
 cfg={'enabled':True,'languages':[{'code':'ur','provider':'google','voice':'Alnilam'},{'code':'ja','provider':'google','voice':'Alnilam'}]}
 body={'folder':str(scripts),'multilingual':cfg,'editingSettings':{'editing_speed':1,'editing_camera_enabled':False,'clipper_captions_enabled':False,'transition_sfx_enabled':False}}
 voice=root/'voice.wav';E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=800:duration=1','-ar','48000',voice]);calls=[];separations=[]
 def synth(provider,voiceid,text,target,**kw):
  if not Path(target).exists():calls.append((provider,kw.get('language'),text));shutil.copy2(voice,target)
  return Path(target)
 def separate(video,folder,python=''):separations.append(str(video));return Path(video)
 with patch.object(E,'ROOT',root),patch.object(V,'synthesize',side_effect=synth),patch.object(M,'translation',side_effect=AssertionError('No translation call')),patch.object(S,'prepare_background',side_effect=separate):
  planned=L.plan(body);assert len(planned['jobs'])==1 and not planned['jobs'][0]['clean_background']
  outputs=L.run(body);assert len(outputs)==2 and len(calls)==4 and set(c[1] for c in calls)=={'ur','ja'}
  assert len(separations)==1 and all(Path(x).parent==project for x in outputs)
  assert all(abs(E.probe(x)['duration']-10)<.2 for x in outputs)
  import numpy as np,subprocess
  pcm=subprocess.run(['ffmpeg','-v','error','-i',outputs[0],'-t','0.8','-f','f32le','-ac','1','-ar','48000','-'],capture_output=True,check=True).stdout
  values=np.frombuffer(pcm,dtype=np.float32);power=np.abs(np.fft.rfft(values));freq=np.fft.rfftfreq(len(values),1/48000)
  assert power[np.argmin(abs(freq-100))]>10 and power[np.argmin(abs(freq-800))]>10
  L.run(body);assert len(calls)==4,'Retry must reuse all narration'
  assert hashlib.sha256(english.read_bytes()).hexdigest()==before
  # Missing translations / changed English stop before speech requests.
  bad=copy.deepcopy(translated);bad['scenes'][0]['script_line']='Different English story.';(scripts/'translated_story.json').write_text(json.dumps(bad))
  try:L.plan(body)
  except ValueError as e:assert 'matching completed English' in str(e)
  else:raise AssertionError('Changed English silently matched')
print('PASS: supplied Urdu/Japanese local batch, strict English/video match, one separation per story, background+voice mixed, original English preserved, cached retry, missing/changed inputs blocked; no real provider or Veo calls.')
