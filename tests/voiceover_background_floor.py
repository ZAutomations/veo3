from pathlib import Path
import tempfile,json,sys,subprocess,wave,math
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import video_editing as E,voiceover as V,full_voiceover as F
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);source=root/'source.mp4';speech=root/'speech.wav';out=root/'mixed.mp4';package=root/'prepared_story.json'
 E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=s=160x90:r=24:d=4','-f','lavfi','-i','sine=frequency=440:duration=4:sample_rate=48000','-c:v','libx264','-c:a','aac',source])
 t=np.arange(4*48000)/48000;signal=.3*np.sin(2*np.pi*1000*t)*(t<2)
 with wave.open(str(speech),'wb') as w:w.setparams((1,2,48000,0,'NONE','not compressed'));w.writeframes((signal*32767).astype('<i2').tobytes())
 package.write_text(json.dumps(dict(full_voiceover_first=True,full_voiceover_file=str(speech),scene_seconds=4,scenes=[{}])))
 cfg=dict(E.defaults(),voiceover_mode='prepared',full_voiceover_keep_source_audio=True,_audio_first_story=str(package))
 V.replace_audio(source,out,cfg,root,aligned_speech_end=4)
 pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(out),'-map','0:a:0','-ar','48000','-ac','1','-f','f32le','-']);samples=np.frombuffer(pcm,dtype='<f4')
 def amplitude(start,stop,freq):
  section=samples[int(start*48000):int(stop*48000)];axis=np.arange(len(section))/48000
  return abs(np.dot(section,np.exp(-2j*np.pi*freq*axis)))*2/len(section)
 under=amplitude(1,1.5,440);pause=amplitude(3,3.5,440);ratio=under/pause
 assert ratio>=.72,ratio
 assert ratio<=1.04,ratio
 assert amplitude(1,1.5,1000)>.25,'Narration must retain a clear foreground level'
 assert np.max(np.abs(samples))<=1.01
 assert abs(E.probe(out)['duration']-4)<.05
 print(f'PASS: background under narration remains {ratio:.1%} of pause level ({20*math.log10(ratio):.2f}dB change), clear narration and unchanged timeline.')
 original=root/'original_story.json';original.write_text(json.dumps(dict(title='Cache fixture',preset_id='geography-map',scene_seconds=10,scenes=[{'script_line':'An approved complete narration line.'}])))
 body={'story':str(original),'editingSettings':dict(voiceover_mode='api',voiceover_provider='google',voiceover_voice='Orus')}
 a=F.plan_package(body)['folder'];body['editingSettings'].update(voiceover_background_volume=90,voiceover_background_floor=100)
 assert F.plan_package(body)['folder']==a,'Mix changes must reuse paid narration'
print('PASS: background mix controls do not change narration cache identity.')
