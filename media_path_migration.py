"""Rebind only proven Full Voiceover media paths; audio/package paths stay intact."""
from pathlib import Path

def canonical_media_path(value):
    try:
        old=Path(value)
        parts=old.parts
        for index,name in enumerate(parts):
            if name!='full_voiceover' or index+2>=len(parts):continue
            package=Path(*parts[:index+2])/'full_voiceover_story.json'
            if not package.is_file():continue
            from story_output import full_voiceover_media_folder
            root=full_voiceover_media_folder(package)
            if root==package.parent:continue
            tail=parts[index+2:]
            if tail[0]=='clips' or (len(tail)==1 and (tail[0].endswith(('.mp4','.webp','.jpg','.png')) or tail[0]=='JOINED_CLIP_ORDER.txt')):
                return str(root.joinpath(*tail))
    except (OSError,ValueError,TypeError):pass
    return value
