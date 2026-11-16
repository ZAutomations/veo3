"""Joined raw English is usable without a final edited export; no paid calls."""
import copy,json,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import local_dubbing as L

with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);project=root/'stories'/'preset'/'original';project.mkdir(parents=True)
    folder=root/'translations';folder.mkdir()
    story={'title':'Fixture','preset_id':'science-what-if','scene_seconds':10,'scenes':[{'script_line':'First exact English line.'},{'script_line':'Second exact English line.'}]}
    original=project/'fixture_story.json';original.write_text(json.dumps(story))
    raw=project/'Fixture raw.mp4';raw.write_bytes(b'test source; probe is mocked')
    report=project/'JOINED_CLIP_ORDER.txt'
    assert L.media_for(original,story) is None,'a raw filename alone does not prove a successful join'
    report.write_text('Completed video: '+str(project/'unrelated.mp4')+'\n01 | 0.00s | scene1\n02 | 10.00s | scene2\n')
    assert L.media_for(original,story) is None,'another video report cannot verify this source'
    report.write_text('Completed video: '+str(raw.resolve())+'\n01 | 0.00s | scene1\n02 | 10.00s | scene2\n')
    assert L.media_for(original,story)==(raw,raw,report,False)
    final=project/'Fixture.mp4';final.write_bytes(b'finished English video must not be used')
    raw.rename(project/'temporarily-unavailable.mp4')
    assert L.media_for(original,story) is None,'never fall back to the final English export when raw is absent'
    (project/'temporarily-unavailable.mp4').rename(raw)
    supplied=copy.deepcopy(story)
    for scene in supplied['scenes']:scene['narration_translations']={'en':scene['script_line'],'ur':'supplied Urdu translation'}
    script=folder/'translated_story.json';script.write_text(json.dumps(supplied))
    (folder/'READY_SCRIPT_ORIGINAL.txt').write_text('Preset: science-what-if\nNarration Urdu: old archived batch\nStory 99\nTitle: Unrelated archived story')
    assert [s['title'] for _,s in L.documents(folder)]==['Fixture'],'original-batch provenance must not become dubbing jobs'
    body={'folder':str(folder),'multilingual':{'enabled':True,'languages':[{'code':'ur','provider':'google','voice':'Alnilam'}]}}
    with patch.object(L.E,'ROOT',root),patch.object(L.E,'probe',return_value={'duration':20}):
        plan=L.plan(body);assert len(plan['jobs'])==1
        assert plan['jobs'][0]['source_is_raw'] is True,'raw-only source must still receive enabled finishing'
        assert Path(plan['jobs'][0]['video'])==raw.resolve()
        assert plan['jobs'][0]['timeline']==[[0.,10.],[10.,20.]]
        supplied['scenes'][0]['script_line']='Changed English line.';script.write_text(json.dumps(supplied))
        try:L.plan(body)
        except ValueError as exc:assert '0 matching completed English projects' in str(exc)
        else:raise AssertionError('Changed English was silently matched')
print('PASS: report-verified joined raw video matches without final export; wrong report/missing report and changed English remain blocked.')
