import json,sys,tempfile,os,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from desktop_app import story_completion
with tempfile.TemporaryDirectory() as folder:
    root=Path(folder);storyfile=root/'test_story.json';storyfile.write_text('{}')
    story={'scenes':[{},{}]};clips=root/'clips';clips.mkdir()
    assert not story_completion(storyfile,story,{})['done']
    a=clips/'a.mp4';a.write_bytes(b'video')
    manifest={'clips':[{'file':'a.mp4','got':True}]}
    assert not story_completion(storyfile,story,manifest)['done']
    manifest['clips'].append({'file':'a.mp4','got':True})
    assert story_completion(storyfile,story,manifest)['downloaded']==1
    b=clips/'b.mp4';b.write_bytes(b'')
    manifest['clips'][1]={'file':'b.mp4','got':True}
    assert not story_completion(storyfile,story,manifest)['done']
    b.write_bytes(b'video')
    assert story_completion(storyfile,story,manifest)['done']
    manifest['clips'][1]['got']=False
    assert not story_completion(storyfile,story,manifest)['done']
    final=root/'clips_final.mp4';final.write_bytes(b'joined')
    os.utime(final,(time.time()+10,time.time()+10))
    assert story_completion(storyfile,story,{})['completion']=='Final video saved'
    os.utime(storyfile,(time.time()+20,time.time()+20))
    assert not story_completion(storyfile,story,{})['done']
print('PASS: available/finished classification handles partial, duplicate, missing, empty, failed downloads and stale final outputs.')
