"""Offline full-track planning, identity alignment, continuous mixing and tail trimming."""
from pathlib import Path
import importlib.util,json,sys,tempfile
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('full_voiceover_worker',Path(__file__).resolve().parents[1]/'full_voiceover.py')
F=importlib.util.module_from_spec(spec);spec.loader.exec_module(F)
import video_editing as E,voiceover as V,desktop_app as app
import voiceover_alignment_repair as recovery

with patch.object(F,'synthesize_full_track',side_effect=[Path('slow.mp3'),Path('paced.mp3')]) as synth, \
        patch.object(V,'audio_duration',side_effect=[82.2,65.0]):
    assert F.paced_google_english(dict(voice='Orus'),['Approved narration.'],Path('.'),60,10)==Path('paced.mp3')
    assert synth.call_args_list[0].args[5]==60 and synth.call_args_list[1].args[5]<60
    assert all(call.args[1]==['Approved narration.'] for call in synth.call_args_list)
with patch.object(F,'synthesize_full_track',return_value=Path('slow.mp3')) as synth, \
        patch.object(V,'audio_duration',side_effect=[82.2,74.0]):
    try:F.paced_google_english(dict(voice='Orus'),['Approved narration.'],Path('.'),60,10)
    except ValueError as error:assert '7 visual clips' in str(error)
    else:raise AssertionError('Overlong English delivery must stop before Veo')
    assert synth.call_count==2

alignment_line = 'one two three four five six seven eight nine ten eleven twelve'
decoded = [dict(word=word, start=i, end=i+.5) for i,word in enumerate(alignment_line.split())]
first = [row for i,row in enumerate(decoded) if i not in (2,8)]
second = [row for i,row in enumerate(decoded) if i not in (4,9)]
assert F.timed_sections([alignment_line],first,12,'en',[second])==[(0.,12)]
misplaced = [dict(row,start=50) if row['word'] in ('three','nine') else row for row in second]
try:F.timed_sections([alignment_line],first,12,'en',[misplaced])
except ValueError:pass
else:raise AssertionError('A second transcript cannot supply words at unrelated timestamps')
assert not recovery.confirmed_omission([alignment_line],first,second,'en')
omitted = [row for i,row in enumerate(decoded) if i not in (2,3)]
assert not recovery.confirmed_omission([alignment_line],omitted,omitted,'en'), 'Unaccounted-for audio may contain those words'
omitted = [dict(row, start=2.55) if row['word']=='five' else dict(row,end=2.5) if row['word']=='two' else row for row in omitted]
assert recovery.confirmed_omission([alignment_line],omitted,omitted,'en')

russian_transcript=[dict(word=word,start=i,end=i+.5) for i,word in enumerate('Разберем 13 см. Слушаем дальше.'.split())]
assert F.timed_sections(['Разберём тринадцать сантиметров.', 'Слушаем дальше.'],russian_transcript,5,language='ru')==[(0.,3.),(3.,5)]
try:F.timed_sections(['Разберём двенадцать сантиметров.', 'Слушаем дальше.'],russian_transcript,5,language='ru')
except ValueError:pass
else:raise AssertionError('Different numbers must not normalize to the same value')

arabic_words='هذه قصة ضقيقة عن التفضيلاة والراحة الإجابات تأتي من الابحاث الحديثة'.split()
arabic_transcript=[dict(word=word,start=i,end=i+.5) for i,word in enumerate(arabic_words)]
assert F.timed_sections(['هذه قصة دقيقة عن التفضيلات والراحة.', 'الإجابات تأتي من الأبحاث الحديثة.'],arabic_transcript,11,language='ar')==[(0.,6.),(6.,11)]
assert F.tokens('١٣', 'ar')==F.tokens('ثلاثة عشر', 'ar')
assert F.tokens('١٢', 'ar')!=F.tokens('١٣', 'ar')
try:F.timed_sections(['قصة مختلفة تماما عن التقنية والمواصلات.'],arabic_transcript,11,language='ar')
except ValueError:pass
else:raise AssertionError('Arabic timing still requires exact transcript anchors')


with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);audio=root/'voice.wav'
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=8.2',audio])
    source=root/'source_story.json'
    story=dict(title='Fixture',preset_id='3d-zack-style',narrated=True,scene_seconds=4,aspect_ratio='9:16',style='Colorful 3D',place=dict(name='Environment'),character_descriptions={},scenes=[])
    for line in ('First mechanism opens.','Second mechanism closes.'):
        story['scenes'].append(dict(script_line=line,narrative_context=line,characters=[],shots=[dict(start_seconds=0,end_seconds=4,visual=line)]))
    source.write_text(json.dumps(story));before=source.read_bytes()
    cfg=E.settings(dict(voiceover_mode='local',voiceover_file=str(audio)))
    body=dict(story=str(source),editingSettings=cfg,multilingual=dict(enabled=False,languages=[]))
    words=[dict(word=t,start=a,end=b) for t,a,b in [('First',0,.4),('mechanism',1,1.5),('opens.',2,2.4),('Second',4.2,4.6),('mechanism',6,6.5),('closes.',8,8.15)]]
    with patch.object(E,'transcribe',side_effect=[[], words]) as transcription:
        track,_=F.record_language(root/'retry',dict(cfg,editing_whisper_model='base'),'en',{},[s['script_line'] for s in story['scenes']],local=audio)
        assert track['seconds']==8.2
        assert [call.args[2]['editing_whisper_model'] for call in transcription.call_args_list]==['base','small']
    fallback=root/'fallback'
    with patch.object(E,'transcribe',return_value=[]),patch.object(F,'synthesize_full_track',return_value=audio) as synthesis:
        localized,_=F.record_language(fallback,cfg,'ja',{'provider':'google','voice':'Orus'},['第一章です。','第二章です。'])
        assert localized['sections']==[(0.,8.2),(8.2,16.4)]
        assert localized['timing_method']=='measured_scene_recordings'
        assert [call.args[1] for call in synthesis.call_args_list][1:]==[['第一章です。'],['第二章です。']]
    with patch.object(F,'synthesize_full_track',side_effect=AssertionError('Reuse timed recording')):
        reused,_=F.record_language(fallback,cfg,'ja',{'provider':'google','voice':'Orus'},['第一章です。','第二章です。'])
    assert reused['file']==localized['file']
    with patch.object(E,'transcribe',return_value=words):prepared=F.prepare(body)
    package=json.loads(prepared.read_text())
    assert len(package['scenes'])==3 and package['full_voiceover_seconds']==8.2
    assert source.read_bytes()==before and package['audio_first_common_pace']==1.
    for n,scene in enumerate(package['scenes']):
        assert scene['full_voiceover_start']==n*4 and scene['script_line']==''
        assert scene['shots'][0]['start_seconds']==0 and scene['shots'][-1]['end_seconds']==4
    prompt=(prepared.parent/'agent_prompt.txt').read_text(encoding='utf-8')
    assert 'Only non-vocal environmental ambience' in prompt and 'NO narration, dialogue, speech' in prompt
    try:F.timed_sections(['Wrong unrelated words.'],words,8.2)
    except ValueError:pass
    else:raise AssertionError('Uncertain mapping must be blocked')
    assert len(F.visual_scenes(story,[(0,33),(33,66)],words,66,10))==7
    assert len(F.visual_scenes(story,[(0,36),(36,72)],words,72,10))==8
    # Real mux/render: one continuous audio plan, no tempo change, protected thumbnail.
    raw=prepared.parent/'Fixture raw.mp4'
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=s=96x160:r=12:d=16','-f','lavfi','-i','sine=frequency=220:duration=16','-c:v','libx264','-c:a','aac',raw])
    report=prepared.parent/'JOINED_CLIP_ORDER.txt'
    report.write_text(f'Completed video: {raw}\n01 | 0.00s | scene-01.mp4\n02 | 4.00s | scene-02.mp4\n03 | 8.00s | scene-03.mp4\n04 | 12.00s | thumbnail.jpg (thumbnail end card)\n')
    with patch.object(E,'sync_video_thumbnail',return_value=None):
        final=E.edit(raw,dict(editing_camera_enabled=False,editing_transitions_enabled=False,silence_removal_enabled=True,audio_first_trim_gaps=True,editing_speed=1.3,preset_cta_enabled=False),output=prepared.parent/'final.mp4')
    assert abs(E.probe(final)['duration']-12.5)<.15
    receipt=json.loads((prepared.parent/'video_editing/last_edit.json').read_text())
    sync=json.loads((prepared.parent/'video_editing'/receipt['signature'][:16]/'voiceover_sync.json').read_text())
    assert len(sync)==1 and sync[0]['audio_end']==8.2 and receipt['speed']==1.
    # Existing queue routing keeps old choices intact, new choice uses an isolated worker.
    payload=dict(view='agent',queue=[str(source)],queueAudioMode='full_voiceover',_editingSettings=cfg,_globalWorkflow=dict(app.GLOBAL_WORKFLOW_DEFAULTS,rotateQueueAccounts=False))
    manifest=root/'local_map.json';manifest.write_text(json.dumps({str(source):dict(audio=str(audio))}))
    payload['audioFirstLocalMap']=str(manifest)
    real_read=app.read_json
    with patch.object(app,'read_json',side_effect=lambda path,*a,**kw: {'multilingual':{'enabled':False}} if Path(path).name=='gui_settings.json' else real_read(path,*a,**kw)),patch.object(E,'settings',return_value=cfg):
        lane,ops=app.plan_action('generate_queue',payload)
    assert ops[0][1][0]=='full_voiceover.py' and ops[-1][1][1]['stories']==[str(F.plan_package(body)['file'])]

    import multilingual as M
    native_lines=['Первый механизм открыт.', 'Второй механизм закрыт.']
    for scene,line in zip(story['scenes'],native_lines):scene['narration_translations']={'ru':line}
    story['multilingual_translation_mode']='supplied_only'
    source.write_text(json.dumps(story),encoding='utf-8')
    multi=dict(enabled=True,languages=[dict(code='ru',provider='google',voice='Orus')])
    russian=root/'russian.wav'
    E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=660:duration=9.5',russian])
    russian_words=[dict(word=t,start=a,end=a+.1) for t,a in zip(' '.join(native_lines).split(),[0,2,3,6.2,7,9.2])]
    multi_body=dict(body,multilingual=multi)
    def transcript(_audio,_folder,settings):
        return russian_words if settings['caption_language']=='russian' else words
    with patch.object(V,'synthesize',return_value=russian) as synth,patch.object(M,'translation',side_effect=AssertionError('Supplied language must be reused')),patch.object(E,'transcribe',side_effect=transcript):
        multilingual_file=F.prepare(multi_body)
        synth.assert_called_once()
        assert synth.call_args.args[2]=='\n\n'.join(native_lines) and synth.call_args.kwargs['language']=='ru'
        assert M.preflight_audio(multilingual_file,multi)==multilingual_file.parent
    multilingual_package=json.loads(multilingual_file.read_text(encoding='utf-8'))
    assert abs(multilingual_package['full_voiceover_visual_sections'][-1][1]-10.2)<.001
    assert multilingual_package['total_scenes']==3
    multilingual_raw=multilingual_file.parent/raw.name
    multilingual_raw.write_bytes(raw.read_bytes())
    (multilingual_file.parent/report.name).write_text(report.read_text().replace(str(raw),str(multilingual_raw)))
    edit_cfg=dict(editing_camera_enabled=False,editing_transitions_enabled=False,preset_cta_enabled=False,clipper_captions_enabled=False)
    with patch.object(E,'sync_video_thumbnail',return_value=None),patch.object(V,'synthesize',side_effect=AssertionError('Render must reuse prepared tracks')):
        english_final=E.edit(multilingual_raw,edit_cfg)
        localized,=M.render(dict(story=str(multilingual_file),editingSettings=edit_cfg))
    for result,expected in [(english_final,8.2),(localized,9.5)]:
        assert abs(E.probe(result)['duration']-(expected+.30+4))<.17
    local_work=multilingual_file.parent/'localized/ru/video_editing'
    receipt=json.loads((local_work/'last_edit.json').read_text())
    sync=json.loads((local_work/receipt['signature'][:16]/'voiceover_sync.json').read_text())
    assert len(sync)==1 and sync[0]['audio_end']==9.5 and receipt['speed']==1.
    assert (source.parent/'Fixture Russian.mp4').is_file()
print('PASS: full-track mode adds clips from actual duration, aligns by words, blocks uncertain mapping, mixes one unchanged track, trims only excess visual tail, preserves thumbnail and original workflows. No paid API/Flow calls.')
