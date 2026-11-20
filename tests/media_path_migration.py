import sys,json,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from media_path_migration import canonical_media_path
from audio_first import rebind_package_paths
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp).resolve();original=root/'source_story.json';original.write_text('{}')
 folder=root/'full_voiceover/hash';folder.mkdir(parents=True)
 package=folder/'full_voiceover_story.json';package.write_text(json.dumps({'full_voiceover_first':True,'original_story':str(original)}))
 (folder/'clips').mkdir()
 old=str(folder/'clips/scene-03.mp4')
 assert canonical_media_path(old)==str(root/'clips/scene-03.mp4')
 assert canonical_media_path(str(folder/'narration.wav'))==str(folder/'narration.wav')
 assert canonical_media_path(str(package))==str(package)
 assert rebind_package_paths([['cli',['node','join_clips.js',str(folder/'clips')]]])[0][1][2]==str(root/'clips')
print('PASS: legacy commands rebind to main folder even with old clips; narration and package unchanged')
