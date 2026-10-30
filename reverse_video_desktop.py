"""Local reverse-engineering job validation and reviewed preset registration."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import threading
import uuid

_save_lock = threading.RLock()


def request_payload(root, payload):
    videos = payload.get('videos', [])
    if not isinstance(videos, list) or not 1 <= len(videos) <= 3:
        raise ValueError('Attach one to three reference videos.')
    resolved = []
    for value in videos:
        if isinstance(value, str) and re.fullmatch(r'https://(?:www\.|m\.)?(?:youtube\.com|youtu\.be)/\S+', value):
            resolved.append(value)
            continue
        file = Path(value).resolve()
        if not file.is_file() or file.suffix.lower() not in {'.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'}:
            raise ValueError('Select an existing supported video file.')
        if file.stat().st_size > 400 * 1024 * 1024:
            raise ValueError('Each reference video must be under 400 MB.')
        resolved.append(str(file))
    if len(set(resolved)) != len(resolved):
        raise ValueError('Remove duplicate reference videos.')
    return dict(videos=resolved, **{key: payload[key] for key in ('reverseName', 'reverseClips', 'reverseAspect', 'reverseMode', 'reverseFps', 'reverseNotes', 'reverseModel') if key in payload})


def run_folder(root, run_id):
    if not re.fullmatch(r'[a-f0-9]{24}', run_id):
        raise ValueError('Select a saved analysis.')
    return root / 'stories' / '_reverse_engineering' / run_id


def list_runs(root):
    folder = root / 'stories' / '_reverse_engineering'
    result = []
    for file in folder.glob('*/request.json'):
        try:
            request = json.loads(file.read_text(encoding='utf-8-sig'))
            complete = file.with_name('complete.json')
            result.append(dict(id=file.parent.name, name=request['options'].get('name') or file.parent.name,
                               complete=complete.is_file(), modified=file.stat().st_mtime))
        except (OSError, ValueError, KeyError):
            pass
    return sorted(result, key=lambda r: r['modified'], reverse=True)


def read_run(root, run_id):
    folder = run_folder(root, run_id)
    if not folder.is_dir():
        raise ValueError('Analysis not found.')
    files = {}
    for file in folder.iterdir():
        if file.name in {'MASTER_PROMPT.txt', 'preset.json', 'REPORT.json', 'REFERENCE_PROMPTS.txt', 'quality_review.json', 'synthesis.json'} or re.fullmatch(r'video_[123]_(analysis|audit|metadata)\.json', file.name):
            files[file.name] = file.read_text(encoding='utf-8-sig')
    return dict(id=run_id, folder=str(folder), complete=(folder / 'complete.json').is_file(), files=files)


def register(root, body):
    folder = run_folder(root, body.get('id', ''))
    if not (folder / 'complete.json').is_file():
        raise ValueError('Finish the analysis before saving a preset.')
    preset = body.get('preset')
    master = body.get('master')
    if not isinstance(preset, dict) or not isinstance(master, str) or not 100 <= len(master) <= 120000:
        raise ValueError('Supply the reviewed preset JSON and complete master prompt.')
    # Apply the same runtime schema used by the analyzer/importer, without model calls.
    script = "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{try{process.stdout.write(JSON.stringify(require('./reverse_video_contract').validatePreset(JSON.parse(s))));}catch(e){console.error(e.message);process.exitCode=1;}});"
    result = subprocess.run(['node', '-e', script], input=json.dumps(preset), text=True,
                            capture_output=True, cwd=root, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError(result.stderr.strip() or 'Invalid preset.')
    preset = json.loads(result.stdout)
    target = root / 'genai_styles.json'
    master_file = root / 'Master prompts' / (preset['id'] + '.txt')
    with _save_lock:
        for registry in ('styles.json', 'genai_styles.json'):
            content = json.loads((root / registry).read_text(encoding='utf-8-sig'))
            if any(p.get('id') == preset['id'] for p in content.get('styles', content.get('presets', []))):
                raise ValueError('That preset ID already exists. Use a new reference- ID to save a separate version.')
        if master_file.exists():
            raise ValueError('A master prompt already exists for this ID. Choose a new ID.')
        original = target.read_bytes()
        data = json.loads(original.decode('utf-8-sig'))
        key = 'styles' if 'styles' in data else 'presets'
        data.setdefault(key, []).append(preset)
        backup = root / 'backups' / 'reverse_presets' / uuid.uuid4().hex
        backup.mkdir(parents=True)
        (backup / 'genai_styles.json').write_bytes(original)
        master_file.parent.mkdir(exist_ok=True)
        staged = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
        staged.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        try:
            with master_file.open('x', encoding='utf-8') as stream:
                stream.write(master)
            staged.replace(target)
        except Exception:
            staged.unlink(missing_ok=True)
            master_file.unlink(missing_ok=True)
            raise
        receipt = dict(preset_id=preset['id'], name=preset['name'], master=str(master_file), registry=str(target),
                       master_sha256=hashlib.sha256(master.encode()).hexdigest())
        (folder / 'registered.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
        return receipt
