from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import full_voiceover as F
source={'scene_seconds':10,'scenes':[{'script_line':'First narration','effect':'2–4 seconds: outline draws onto the valve.','sound':'SFX: metallic click; BGM: piano','shots':[{'start_seconds':0,'end_seconds':10,'visual':'The valve opens.'}]},{'script_line':'Second narration','effect':'A bubble appears.','sound':'SFX: soft plop','shots':[{'start_seconds':0,'end_seconds':10,'visual':'The bubble rises.'}]}]}
scenes=F.visual_scenes(source,[(0,12),(12,22)],[],22,10)
events=scenes[1]['external_visual_events'];assert len(events)==2
assert events[0]['start_seconds']==0 and events[0]['end_seconds']==2
assert events[0]['source_start_seconds']==8.333
assert events[1]['start_seconds']==2 and events[1]['end_seconds']==10
assert events[0]['effect']==source['scenes'][0]['effect']
assert 'effect' not in scenes[1] and scenes[1]['script_line']==''
assert source['scenes'][0]['script_line']=='First narration'
print('PASS: full-track rebatching preserves source effects/SFX and exact source-to-clip intervals, without copying stale effect timestamps or changing narration.')
