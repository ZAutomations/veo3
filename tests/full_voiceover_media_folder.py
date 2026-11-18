"""New Full Voiceover First media lives beside the original story."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json,subprocess,sys,wave
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import video_editing as E
from story_output import full_voiceover_media_folder,prepared_story_for_media
tool=Path(__file__).resolve().parents[1]
with TemporaryDirectory() as temporary:
 root=Path(temporary).resolve()
 from PIL import Image
 Image.effect_noise((240,400),80).save(root/'Fixture.png')
 original=root/'fixture_story.json'
 original.write_text(json.dumps(dict(title='Fixture',preset_id='3d-zack-style',scenes=[{},{}])),encoding='utf-8')
 audio=root/'full_voiceover'/'key'
 audio.mkdir(parents=True)
 prepared=audio/'full_voiceover_story.json'
 with wave.open(str(audio/'narration.wav'),'wb') as out:
  out.setparams((1,2,48000,0,'NONE','not compressed'))
  out.writeframes((b'\x00\x10'*48000)*2)
 package=dict(title='Fixture',preset_id='3d-zack-style',audio_first=True,full_voiceover_first=True,
              original_story=str(original),full_voiceover_file=str(audio/'narration.wav'),
              full_voiceover_seconds=2,scene_seconds=1,scenes=[{},{}])
 prepared.write_text(json.dumps(package))
 clips=root/'clips';clips.mkdir()
 for i in (1,2):
  E.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'color={"red" if i==1 else "blue"}:s=128x224:r=24:d=1',
         '-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1','-c:v','libx264','-c:a','aac',clips/f'scene-0{i}.mp4'])
 (clips/'manifest.json').write_text(json.dumps(dict(expected=2,complete=True,preparedStory=str(prepared.relative_to(root)),
   clips=[dict(file=f'scene-0{i}.mp4',matched_scene=i,order=i,got=True,order_verified=True) for i in (1,2)])))
 env=dict(__import__('os').environ,VEO_EDITING_SETTINGS='{"editing_auto_apply":false}')
 subprocess.run(['node',str(tool/'join_clips.js'),str(clips),'--no-thumbnail'],env=env,check=True,capture_output=True)
 raw=root/'Fixture raw.mp4'
 assert prepared_story_for_media(raw)==prepared
 assert full_voiceover_media_folder(prepared)==root
 result=E.edit(raw,dict(editing_camera_enabled=False,editing_transitions_enabled=False,preset_cta_enabled=False),
               report=root/'JOINED_CLIP_ORDER.txt')
 assert result==root/'Fixture.mp4' and E.probe(result)['audio']
 assert not list(audio.rglob('*.mp4'))
 assert not (audio/'clips').exists()
 legacy=audio/'clips';legacy.mkdir()
 assert full_voiceover_media_folder(prepared)==audio
print('PASS: main-folder join and prepared narration edit; legacy clip folders retain their existing paths.')
