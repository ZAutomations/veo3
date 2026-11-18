from pathlib import Path
import json,tempfile,sys,subprocess
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import narration_delivery as D,full_voiceover as F
lines=[' '.join(['word']*n) for n in (29,28,28,28,28,30)]
bad=[(0,16),(16,26),(26,36),(36,42),(42,52),(52,62)]
assert not D.pace_audit(lines,bad)['ok']
good=[];x=0
for line in lines:
 y=x+len(line.split())/2.9;good.append((x,y));x=y
assert D.pace_audit(lines,good)['ok']
story={'preset_id':'geography-map','scenes':[{'script_line':'The earthquake killed many people.'},{'script_line':'The army began its campaign.'}]}
tone=D.profile(story)
assert 'cartographic storyteller' in tone and 'Respectful gravity' in tone and 'controlled urgency' in tone and 'not abrupt speed changes' in tone
js=subprocess.check_output(['node','-e','process.stdout.write(require("./narration_delivery").direction('+json.dumps(story)+'))'],text=True)
assert 'Respectful gravity' in js and 'controlled urgency' in js
assert all(f.stem in json.loads(Path('narration_tones.json').read_text())['profiles'] for f in Path('Master prompts').glob('*.txt') if f.stem not in ('00_START_HERE','video-reverse-engineering'))
with tempfile.TemporaryDirectory() as tmp:
 attempts=[]
 def once(folder,cfg,code,profile,lines,*args):
  attempts.append(profile)
  return {'sections':bad if len(attempts)==1 else good},[]
 with patch.object(F,'_record_language_once',side_effect=once):
  track,_=F.record_language(Path(tmp),{},'en',{'provider':'google','voice':'Orus','delivery':tone},lines)
 assert len(attempts)==2 and track['pace_audit']['ok'] and attempts[1]['voice']=='Orus'
 assert (Path(tmp)/'PACE_AUDIT.json').exists()
 assert (Path(tmp)/'consistent_pace_1/PACE_AUDIT.json').exists()
with tempfile.TemporaryDirectory() as tmp:
 with patch.object(F,'_record_language_once',return_value=({'sections':bad},[])) as recording:
  try:F.record_language(Path(tmp),{},'en',{'provider':'google','voice':'Orus'},lines)
  except ValueError as error:assert 'no visuals submitted' in str(error)
  else:raise AssertionError('Persistent pace failure must not authorize visuals')
  assert recording.call_count==3
print('PASS: severe speech-rate variation detected, uniform track accepted, unchanged voice/text retry, per-preset coverage and situation tones shared by native/Google.')

fixture=json.loads(Path(__file__).with_name('fixtures').joinpath('speech_load_pacing.json').read_text())
for durations in fixture['recordings']:
 sections=[];start=0
 for duration in durations:sections.append((start,start+duration));start+=duration
 audit=D.pace_audit(fixture['lines'],sections)
 assert audit['ok'],audit
 assert audit['printed_word_rate_ratio']>1.35
 assert audit['method']=='speech_load_v2'
assert D.number_syllables('2026')==5
assert D.number_syllables('17')==3
assert D.spoken_load('international military operations')>D.spoken_load('the short map')
print('PASS: all three real cached Hormuz recordings accepted with speech-load correction; dates and long words no longer cause false pacing failure.')
