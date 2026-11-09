"""Read-only, preset-scoped duplicate warnings for Studio writing/import."""
import json
import re
import unicodedata
from collections import Counter


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFKC', str(value)).casefold() if c.isalnum())


def check(root, action, payload):
    if action not in ('write', 'import_script'):
        return []
    preset = payload.get('preset', '')
    if action == 'import_script':
        blocks = re.split(r'(?im)(?=^Story\s+\d+\s*$)', str(payload.get('readyScript', '')))
        requested = []
        for block in blocks:
            title = re.search(r'(?im)^Title:\s*(.+)$', block)
            style = re.search(r'(?im)^Preset:\s*(.+)$', block)
            if title:
                requested.append((title[1].strip(), style[1].strip() if style else preset))
    elif payload.get('source') == 'links':
        return []
    else:
        from story_ideas import parse_ideas
        requested = [(x.get('title', ''), x.get('preset') or preset) for x in parse_ideas(payload.get('ideas', ''))]
    index = {}
    folder = root / 'stories'
    if folder.is_dir():
        for file in folder.rglob('*_story.json'):
            try:
                data = json.loads(file.read_text(encoding='utf-8-sig'))
            except (OSError, ValueError):
                continue
            index.setdefault((normalized(data.get('title', '')), data.get('preset_id', data.get('preset', ''))), []).append(str(file))
    counts = Counter((normalized(title), style) for title, style in requested)
    warnings = []
    seen = set()
    for title, style in requested:
        key = (normalized(title), style)
        if key in seen:
            continue
        seen.add(key)
        paths = index.get(key, [])
        if paths or counts[key] > 1:
            warnings.append(dict(title=title, preset=style, existing=paths, occurrences=counts[key]))
    return warnings
