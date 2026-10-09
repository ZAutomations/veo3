"""Build a personal Windows transfer package without generated video outputs."""
import datetime
import json
import pathlib
import re
import shutil
import subprocess
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
STAMP = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
DEST = ROOT.parent / ('Veo3_Portable_' + STAMP)

def excluded(path):
    parts = path.parts
    name = path.name.lower()
    return (any(p.lower() in {'writing_progress', 'extra files', 'clips', 'logs', 'backups', '__pycache__', 'node_modules', '.git', '_answers', 'downloads', '.venv'} for p in parts)
            or name.startswith(('test_', 'probe_', '.tmp_', 'debug_flow_'))
            or ('stories' in parts and name.startswith(('agent_batches_', 'agent_batch_')))
            or name.endswith(('.mp4', '.webm', '.mov', '.pyc', '.bak', '_failed.txt'))
            or '.before' in name or name in {'handoff.md', 'project_summary.md', 'setup.log',
                'find_character_ui.js', 'read_flow_state.js', 'clear_prompt.js', 'show_config.js',
                'repair_echoes_speakers.js', 'convert_bridge_story.py', 'verify_join_audio_sync.py'})

def main():
    DEST.mkdir()
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    paths = {pathlib.Path(p) for p in tracked if p}
    paths.update(p.relative_to(ROOT) for pattern in ('*.js', '*.py', '*.bat') for p in ROOT.glob(pattern))
    for name in ('Setup', 'stories', 'AI-STUDIO-WORKFLOW', 'GEMINI-BY-HAND'):
        directory = ROOT / name
        if directory.exists():
            paths.update(p.relative_to(ROOT) for p in directory.rglob('*') if p.is_file())
    paths.update(pathlib.Path(p) for p in ('gui_settings.json', 'accounts.json', 'PORTABLE-START-HERE.txt'))
    copied = []
    for rel in sorted(paths):
        if excluded(rel) or not (ROOT / rel).is_file():
            continue
        target = DEST / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, target)
        copied.append(rel.as_posix())
    # Do not advertise development commands whose test/probe files are excluded.
    package_path = DEST / 'package.json'
    package = json.loads(package_path.read_text(encoding='utf-8-sig'))
    package['scripts'] = {k: v for k, v in package.get('scripts', {}).items()
                          if k != 'check' and not k.startswith('test') and 'probe_' not in v}
    package_path.write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')
    accounts_path = DEST / 'accounts.json'
    if accounts_path.exists():
        accounts = json.loads(accounts_path.read_text(encoding='utf-8-sig'))
        accounts.pop('browser', None)
        accounts_path.write_text(json.dumps(accounts, indent=2) + '\n', encoding='utf-8')
    # Catch omitted modules before handing the package to another computer.
    for source in DEST.rglob('*.js'):
        for local in re.findall(r"require\(\s*['\"](\.[^'\"]+)['\"]", source.read_text(encoding='utf-8-sig')):
            candidate = source.parent / local
            if not any(p.exists() for p in (candidate, pathlib.Path(str(candidate) + '.js'), pathlib.Path(str(candidate) + '.json'))):
                raise RuntimeError(f'Missing local module {local} in {source.relative_to(DEST)}')
    manifest = {'sourceRoot': str(ROOT), 'builtAt': datetime.datetime.now().isoformat(),
                'fileCount': len(copied), 'personalSettingsIncluded': True,
                'excludes': ['rendered videos', 'download folders', 'browser logins', 'generation checkpoints', 'installed dependencies', 'Git history']}
    (DEST / 'portable_manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    archive = pathlib.Path(str(DEST) + '.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for path in DEST.rglob('*'):
            if path.is_file():
                bundle.write(path, pathlib.Path(DEST.name) / path.relative_to(DEST))
    print(json.dumps({'folder': str(DEST), 'zip': str(archive), 'files': len(copied), 'zipMB': round(archive.stat().st_size / 1024**2, 1)}))

if __name__ == '__main__':
    main()
