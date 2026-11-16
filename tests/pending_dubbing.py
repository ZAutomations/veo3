"""English-first deferral, folder discovery and real local export without Veo."""
from pathlib import Path
from unittest.mock import patch
import json
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import desktop_app as app
import full_voiceover as F
import local_dubbing as L
import multilingual as M
import video_editing as E
import voiceover as V


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    folder = root / 'preset' / 'test';folder.mkdir(parents=True)
    source = folder / 'fixture_story.json'
    lines = ['A simple complete explanation.', 'Another simple complete explanation.']
    translations = ['Первый механизм открыт.', 'Второй механизм закрыт.']
    story = dict(title='Fixture', preset_id='3d-zack-style', narrated=True, scene_seconds=4, aspect_ratio='9:16',
                 style='3D', place=dict(name='Environment'), character_descriptions={}, scenes=[
        dict(script_line=en,narration_translations={'ru':ru,'ja':'音声の説明。'},characters=[],
             narrative_context='Show the mechanism.',shots=[dict(start_seconds=0,end_seconds=4,visual='Show it.')])
        for en, ru in zip(lines,translations)])
    source.write_text(json.dumps(story), encoding='utf-8')
    audio = folder / 'source.wav'
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=duration=6',audio])
    cfg=E.settings(dict(voiceover_mode='local',voiceover_file=str(audio),editing_camera_enabled=False,
                        editing_transitions_enabled=False,preset_cta_enabled=False,clipper_captions_enabled=False))
    language=dict(code='ru',provider='google',voice='Orus')
    multi=dict(enabled=True,languages=[language])
    selected=dict(view='agent',queue=[str(source)],queueAudioMode='full_voiceover',deferDubbing=True,_editingSettings=cfg,
                  _globalWorkflow=dict(app.GLOBAL_WORKFLOW_DEFAULTS,rotateQueueAccounts=False,generationOnly=False))
    manifest=root/'recordings.json';manifest.write_text(json.dumps({str(source):dict(audio=str(audio))}))
    selected['audioFirstLocalMap']=str(manifest)
    _,ops=app.plan_action('generate_queue',selected)
    body=ops[0][1][1]
    assert body['defer_dubbing'] is True
    assert ops[-1][1][1]['download'] and ops[-1][1][1]['join']
    words=lambda text:[dict(word=w,start=(i//len(text[0].split()))*3+(i%len(text[0].split()))*.5,
                            end=(i//len(text[0].split()))*3+(i%len(text[0].split()))*.5+.3)
                       for i,w in enumerate(' '.join(text).split())]
    with patch.object(E,'transcribe',return_value=words(lines)),patch.object(V,'synthesize',side_effect=AssertionError('No foreign TTS yet')):
        prepared=F.prepare(body)
    package=json.loads(prepared.read_text(encoding='utf-8'))
    assert package['deferred_dubbing']==['ru','ja'] and not package.get('multilingual')
    assert set(package['full_voiceover_tracks'])=={'en'}
    scan=dict(folder=str(root),multilingual=multi,pending_only=True,editingSettings=cfg)
    assert not L.plan(scan)['jobs'], 'Unfinished English projects are skipped'
    raw=prepared.parent/'Fixture raw.mp4'
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=s=96x160:r=12:d=8',
           '-f','lavfi','-i','sine=duration=8','-c:v','libx264','-c:a','aac',raw])
    report=prepared.parent/'JOINED_CLIP_ORDER.txt'
    report.write_text(f'Completed video: {raw}\n01 | 0.00s | scene-01.mp4\n02 | 4.00s | scene-02.mp4\n')
    with patch.object(E,'sync_video_thumbnail',return_value=None):
        E.edit(raw,cfg)
    english=folder/'Fixture.mp4';original=english.read_bytes()
    job,=L.plan(scan)['jobs']
    assert job['pending']==['ru','ja'] and job['missing_voices']==['ja'] and job['clean_background']
    with patch.object(E,'transcribe',return_value=words(translations)),patch.object(V,'synthesize',return_value=audio) as calls, \
         patch.object(M,'translation',side_effect=AssertionError('Use supplied script only')):
        output,=L.run(scan)
    assert calls.call_count==1 and calls.call_args.kwargs['language']=='ru'
    assert Path(output).is_file() and (folder/'Fixture Russian.mp4').is_file() and english.read_bytes()==original
    remaining,=L.plan(scan)['jobs']
    assert remaining['pending']==['ja'] and not remaining['profiles']
    assert L.run(scan)==[]

print('PASS: English-only queue defers supplied languages, scans only completed jobs, renders missing Russian locally, leaves Japanese pending and preserves English.')
