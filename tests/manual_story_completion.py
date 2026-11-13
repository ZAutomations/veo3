"""Manual finishing hides final videos, not merely downloaded clips."""
import json,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
from story_output import story_video_path
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);base=root/'stories';base.mkdir()
 def story(name,**extra):
  folder=base/name;folder.mkdir();file=folder/(name+'_story.json');file.write_text(json.dumps(dict(title=name,preset_id='3d-zack-style',scene_seconds=10,scenes=[{'script_line':'Original complete narration.'}],**extra)));return file
 finished=story('finished');story_video_path(finished).write_bytes(b'video')
 downloaded=story('downloaded');clips=downloaded.parent/'clips';clips.mkdir();(clips/'scene-01.mp4').write_bytes(b'clip');(clips/'manifest.json').write_text(json.dumps({'clips':[{'file':'scene-01.mp4','got':True}]}))
 pending=story('pending',audio_first=True,multilingual={'enabled':True,'languages':[{'code':'ru','provider':'heygen','voice':'voice'}]});story_video_path(pending).write_bytes(b'english')
 parent=story('original');folder=parent.parent/'audio_first'/'test';folder.mkdir(parents=True);child=folder/'prepared_story.json';child.write_text(json.dumps(dict(title='Prepared',preset_id='3d-zack-style',audio_first=True,original_story=str(parent),scenes=[{'external_narration':'Original complete narration.'}])));story_video_path(child).write_bytes(b'final')
 with patch.object(app,'ROOT',root):
  rows={Path(row['path']).name:row for row in app.library()}
 assert rows[finished.name]['fullyComplete'];assert not rows[downloaded.name]['fullyComplete'] and rows[downloaded.name]['done']
 assert not rows[pending.name]['fullyComplete'] and 'languages pending' in rows[pending.name]['completion']
 assert rows[parent.name]['fullyComplete'],'fully finished matching Audio First package completes its original story'
 ru=story_video_path(pending).with_name('pending Russian.mp4');ru.write_bytes(b'russian')
 with patch.object(app,'ROOT',root):assert next(row for row in app.library() if row['path']==str(pending))['fullyComplete']
print('PASS: completed videos hidden, downloaded-only and unfinished-language projects retained, matching completed Audio First originals recognized.')
