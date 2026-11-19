from pathlib import Path
import re


def saved_owner(story_file, state, accounts, normalize_project, project):
    email = str(state.get('account_email') or '').strip()
    marker = Path(story_file).parent / 'incomplete project.txt'
    if not email and marker.is_file():
        text = marker.read_text(encoding='utf-8-sig')
        saved_url = re.search(r'^Flow project URL:\s*(.+)$', text, re.M)
        if saved_url and normalize_project(saved_url.group(1).strip(), required=True) != project:
            raise ValueError('The incomplete marker belongs to another Flow project.')
        match = re.search(r'^Google account \(Gmail\):\s*(.+)$', text, re.M)
        if match:
            email = match.group(1).strip()
    if not email:
        raise ValueError('This legacy incomplete project has no saved Google account. Select its original account and mark it incomplete again before resuming.')
    matches = [row for row in accounts if str(row.get('email') or '').strip().casefold() == email.casefold()]
    if len(matches) != 1:
        raise ValueError('The saved incomplete-project Gmail must match exactly one account in Accounts. Update that account email before resuming.')
    return matches[0]


def list_incomplete(root):
    import json
    folders = {p.parent for pattern in ('incomplete project.txt', 'incomplete project.resume.json') for p in Path(root).rglob(pattern)}
    rows = []
    for folder in folders:
        try:
            marker = folder / 'incomplete project.txt'
            state_path = folder / 'incomplete project.resume.json'
            state = json.loads(state_path.read_text(encoding='utf-8-sig')) if state_path.is_file() else {}
            if state.get('status') == 'completed':
                continue
            text = marker.read_text(encoding='utf-8-sig') if marker.is_file() else ''
            def field(name):
                match = re.search(r'^' + re.escape(name) + r':\s*(.+)$', text, re.M)
                return match.group(1).strip() if match else ''
            story = str(state.get('story') or field('Story JSON'))
            if not story:
                candidates = list(folder.glob('*_story.json'))
                if len(candidates) == 1: story = str(candidates[0])
            data = json.loads(Path(story).read_text(encoding='utf-8-sig')) if story and Path(story).is_file() else {}
            rows.append(dict(story=story, project=state.get('project') or field('Flow project URL'),
                             gmail=state.get('account_email') or field('Google account (Gmail)'),
                             title=data.get('title') or folder.name, preset=data.get('preset') or data.get('style') or '',
                             phase=state.get('phase') or field('Saved phase') or 'Legacy download',
                             markedAt=state.get('saved_at') or max(p.stat().st_mtime for p in (marker,state_path) if p.exists()),
                             resumable=bool(data and (state.get('project') or field('Flow project URL')))))
        except (ValueError, OSError, TypeError):
            continue
    return sorted(rows, key=lambda row: row['markedAt'], reverse=True)


def download_and_finish(plan_action, payload):
    """Resume finishing only: never reconstruct the generation queue."""
    inputs = dict(payload, generationOnly=False, newProject=False, genRefs=False)
    lane, operations = plan_action('download', inputs)
    operations = list(operations)
    if inputs.get('join', True):
        _, finishing = plan_action('join', inputs)
        operations.extend(finishing)
    return lane, operations


def complete_incomplete(story_file, project=''):
    """Archive only this story's marker after successful join and its editing hook."""
    import json
    import time
    folder = Path(story_file).resolve().parent
    marker = folder / 'incomplete project.txt'
    state_file = folder / 'incomplete project.resume.json'
    if not marker.is_file() and not state_file.is_file():
        return False
    state = json.loads(state_file.read_text(encoding='utf-8-sig')) if state_file.is_file() else {}
    if state.get('story') and Path(state['story']).resolve() != Path(story_file).resolve():
        return False
    if project and state.get('project') and state['project'].rstrip('/') != project.rstrip('/'):
        return False
    if marker.is_file():
        # Keep an audit copy, without an active incomplete filename.
        marker.replace(folder / 'completed project.txt')
    state.update(status='completed', completed_at=time.time(), story=str(Path(story_file).resolve()))
    temp=state_file.with_suffix('.tmp')
    temp.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
    temp.replace(state_file)
    return True
