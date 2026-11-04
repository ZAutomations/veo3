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
