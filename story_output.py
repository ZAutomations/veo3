"""Shared story-title-based filenames for joined and edited exports."""
from pathlib import Path
import json
import re


def safe_story_title(value, fallback='video'):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', ' ', str(value or ''))
    name = re.sub(r'\s+', ' ', name).strip().rstrip('. ')
    if not name or re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])', name, re.I):
        name = fallback
    return name[:180].rstrip('. ') or 'video'


def story_title_base(story_path):
    story = Path(story_path)
    fallback = story.parent.name or 'video'
    try:
        data = json.loads(story.read_text(encoding='utf-8-sig'))
        title = data.get('title') if isinstance(data, dict) else None
    except (OSError, ValueError):
        title = None
    return safe_story_title(title, fallback)


def story_video_path(story_path):
    story = Path(story_path)
    return story.parent / f'{story_title_base(story)}.mp4'


def publish_audio_first_exports(story_path, files):
    """Publish finished media beside the original story; keep resumable package files."""
    import os, shutil
    story=Path(story_path).resolve()
    data=json.loads(story.read_text(encoding='utf-8-sig'))
    if not data.get('audio_first') or not data.get('original_story'):return []
    original=Path(data['original_story']).expanduser().resolve()
    if not original.is_file():raise ValueError('Original Audio First story is missing; cannot publish to its normal folder.')
    original_data=json.loads(original.read_text(encoding='utf-8-sig'))
    if original_data.get('audio_first'):raise ValueError('Audio First export must point to an original story.')
    outputs=[]
    for value in files:
        source=Path(value).resolve()
        if not source.is_file() or source.suffix.lower() not in ('.mp4','.jpg','.jpeg','.png','.webp'):continue
        dest=original.parent/source.name
        if source==dest:outputs.append(dest);continue
        # Cached retries do not recopy large, unchanged exports.
        if dest.is_file() and dest.stat().st_size==source.stat().st_size and dest.stat().st_mtime_ns==source.stat().st_mtime_ns:
            outputs.append(dest);continue
        tmp=dest.with_name(dest.name+f'.publishing-{os.getpid()}')
        try:shutil.copy2(source,tmp);os.replace(tmp,dest)
        finally:tmp.unlink(missing_ok=True)
        outputs.append(dest)
    return outputs
