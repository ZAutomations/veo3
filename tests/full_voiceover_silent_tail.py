from pathlib import Path
import tempfile,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import full_voiceover as F,video_editing as E,voiceover as V
with tempfile.TemporaryDirectory() as temp:
 root=Path(temp);quiet=root/'quiet.wav';talking=root/'not_quiet.wav'
 E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=9.7','-af','apad=whole_dur=10.16','-ar','48000','-ac','1',quiet])
 fitted=F.fit_verified_silent_tail(quiet,V.audio_duration(quiet),10)
 assert fitted and abs(V.audio_duration(fitted)-10)<.02
 assert abs(V.audio_duration(quiet)-10.16)<.02
 E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=10.16','-ar','48000','-ac','1',talking])
 assert F.fit_verified_silent_tail(talking,V.audio_duration(talking),10) is None
 assert F.fit_verified_silent_tail(quiet,12.1,10) is None
print('PASS: verified 160ms quiet overflow trimmed at 1.00x; audible ending, unverified padding and larger overflow remain protected; original preserved.')
