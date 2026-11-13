"""Offline real-media multilingual checks. No browser/API requests."""
import json,sys,tempfile,shutil
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import multilingual as M
import video_editing as E
import voiceover as V
assert not M.configuration(None)['enabled']
for bad in [{'enabled':True,'languages':[]},{'enabled':True,'languages':[{'code':'ru','voice':''}]},{'enabled':True,'languages':[{'code':'xx','voice':'test'}]}]:
    try:M.configuration(bad)
    except ValueError:pass
    else:raise AssertionError('Invalid profiles accepted')
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);file=root/'english_story.json';raw=root/'Fixture raw.mp4'
    story=dict(title='Fixture',audio_first=True,scene_seconds=4,preset_id='3d-zack-style',scenes=[dict(external_narration='First scene explains the mechanism.',audio_first_file='unused'),dict(external_narration='Second scene explains the result.',audio_first_file='unused')])
    file.write_text(json.dumps(story));original=file.read_bytes()
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=blue:s=64x96:r=10:d=10','-f','lavfi','-i','sine=frequency=100:duration=10','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',raw])
    shutil.copy2(raw,root/'Fixture.mp4')
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=size=160x240','-frames:v','1',root/'thumbnail_downloaded.png'])
    (root/'JOINED_CLIP_ORDER.txt').write_text(f'Completed video: {raw}\n01 | 0.00s | scene-01.mp4\n02 | 4.00s | scene-02.mp4\n03 | 8.00s | thumb.jpg (thumbnail end card)\n')
    voice=root/'voice.wav';E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=800:duration=1','-ar','48000',voice])
    cfg={'enabled':True,'languages':[dict(code='ru',provider='heygen',voice='voice-ru'),dict(code='ar',provider='elevenlabs',voice='voice-ar')]}
    translated=[];synthesized=[]
    def translate(lines,code,seconds,out,feedback=None):
        translated.append(code);text=['Первое объяснение.','Второе объяснение.'] if code=='ru' else ['شرح أول.','شرح ثان.'];M.atomic(out,text);return text
    def synth(provider,voiceid,text,target):
        if not Path(target).exists():synthesized.append((provider,voiceid,text));shutil.copy2(voice,target)
        return Path(target)
    with patch.object(M,'translation',translate),patch.object(V,'synthesize',synth):
        outputs=M.render(dict(story=str(file),multilingual=cfg,editingSettings=dict(editing_speed=1,clipper_captions_enabled=False,editing_camera_enabled=False,silence_removal_enabled=True)))
        assert len(outputs)==2 and all(Path(p).is_file() for p in outputs)
        assert translated==['ru','ar'];assert [x[1] for x in synthesized]==['voice-ru']*2+['voice-ar']*2
        for out in outputs:assert abs(E.probe(out)['duration']-10)<.2
        import numpy as np,subprocess
        pcm=subprocess.run(['ffmpeg','-v','error','-i',outputs[0],'-t','0.8','-f','f32le','-ac','1','-ar','48000','-'],capture_output=True,check=True).stdout
        samples=np.frombuffer(pcm,dtype=np.float32);power=np.abs(np.fft.rfft(samples));freq=np.fft.rfftfreq(len(samples),1/48000)
        assert power[np.argmin(abs(freq-100))]>10 and power[np.argmin(abs(freq-800))]>10,'both background and localized voice must remain audible'
        before=len(synthesized);M.render(dict(story=str(file),multilingual=cfg,editingSettings=dict(editing_speed=1,clipper_captions_enabled=False,editing_camera_enabled=False)))
        assert len(synthesized)==before and translated==['ru','ar'],'retry must reuse scripts and provider audio'
    assert file.read_bytes()==original
    # Preserve pre-supplied-script cache identities for existing English packages.
    import hashlib
    expected=hashlib.sha256(json.dumps([[s['external_narration'] for s in story['scenes']],cfg,4],sort_keys=True).encode()).hexdigest()[:16]
    assert (root/'multilingual'/expected/'manifest.json').exists()
    # Small overruns can use the explicitly requested 9.8s finish window.
    boundary=root/'boundary.wav';E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=duration=10.481',boundary])
    fitted,duration=M.fit(boundary,9.8,root/'boundary_fitted.wav');assert 9.7<=duration<=9.83
    # A long narration cannot be silently accelerated/cropped.
    long=root/'long.wav';E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=duration=3',long])
    try:M.fit(long,1,root/'bad.wav')
    except ValueError:pass
    else:raise AssertionError('Excessive speed allowed')
print('PASS: two sequential languages, saved provider/voice choices, real background mixing and verified scene/endcard duration, cached retries, original preserved, excessive speed rejected; no paid calls.')
