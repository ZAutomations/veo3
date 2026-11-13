import json,sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from story_output import publish_audio_first_exports
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);original=root/'story.json';original.write_text(json.dumps({'title':'Title'}));package=root/'audio_first/package';package.mkdir(parents=True);story=package/'title_story.json';story.write_text(json.dumps({'audio_first':True,'original_story':str(original)}))
 files=[]
 for name in ['Title.mp4','Title raw.mp4','Title Russian.mp4','Title Arabic.mp4','Title.jpg']:
  file=package/name;file.write_bytes(name.encode());files.append(file)
 out=publish_audio_first_exports(story,files);assert len(out)==5
 for source,dest in zip(files,out):assert dest.parent==root and dest.read_bytes()==source.read_bytes() and source.exists()
 timestamps=[f.stat().st_mtime_ns for f in out];publish_audio_first_exports(story,files);assert timestamps==[f.stat().st_mtime_ns for f in out]
 story.write_text(json.dumps({'title':'Native'}));assert publish_audio_first_exports(story,files)==[]
print('PASS: English/raw/localized video and thumbnail publish beside original story; package sources preserved; cached retries stable; Native unaffected.')
