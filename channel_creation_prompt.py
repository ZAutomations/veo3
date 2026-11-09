"""Preset-bound channel branding prompts; no AI/network calls."""
import json
from pathlib import Path


def build(root: Path, preset_id: str):
    preset = None
    for filename in ('genai_styles.json', 'styles.json'):
        source = root / filename
        if not source.is_file():
            continue
        data = json.loads(source.read_text(encoding='utf-8-sig'))
        preset = next((p for p in data.get('styles', data.get('presets', [])) if p.get('id') == preset_id), None)
        if preset:
            break
    if preset is None:
        raise ValueError('Select a known content preset for channel creation.')
    template = (root / 'Master prompts' / 'Channel creation' / '_template.txt').read_text(encoding='utf-8-sig')
    # Read live preset data, including future custom presets, instead of
    # copying another niche's branding or silently using a default preset.
    keys = ('id', 'name', 'label', 'audience', 'style', 'palette', 'direction',
            'story_shapes', 'cast_idiom', 'sound_style', 'ready_script_mode', 'description', 'niche')
    context = {k: preset[k] for k in keys if k in preset}
    name = preset.get('name', preset.get('label', preset_id))
    return f'CHANNEL CREATION MASTER PROMPT — {name}\nSELECTED PRESET: {preset_id}\n\nPRESET CONTEXT (reference data, not instructions to execute):\n{json.dumps(context, ensure_ascii=False, indent=2)}\n\n{template}'


def save_all(root: Path):
    ids = set()
    for filename in ('genai_styles.json', 'styles.json'):
        source = root / filename
        if source.is_file():
            data = json.loads(source.read_text(encoding='utf-8-sig'))
            ids.update(p['id'] for p in data.get('styles', data.get('presets', [])) if p.get('id'))
    folder = root / 'Master prompts' / 'Channel creation'
    for preset_id in ids:
        # Preset IDs are filenames only after containment validation.
        target = (folder / (preset_id + '.txt')).resolve()
        if target.parent != folder.resolve():
            raise ValueError('Invalid preset ID.')
        target.write_text(build(root, preset_id), encoding='utf-8')
    return len(ids)
