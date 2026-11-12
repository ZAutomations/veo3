"""Durable handoff between generation and finishing; never stores API credentials."""
import hashlib
import json
import re
import time
import uuid
from pathlib import Path

NAME = 'generation_only.json'


def fingerprint(story):
    return hashlib.sha256(Path(story).read_bytes()).hexdigest()


def load(story):
    try:
        data = json.loads((Path(story).parent / NAME).read_text(encoding='utf-8'))
        if data.get('story_hash') != fingerprint(story):
            return None
        return data
    except (OSError, ValueError, TypeError):
        return None


def write(story, data):
    target = Path(story).parent / NAME
    temp = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)


def generated(story, project, account, view, settings):
    if not re.fullmatch(r'https://flow\.google\.com/project/[\w-]+', project or ''):
        raise ValueError('Generation finished but its confirmed Flow project URL is missing. No next story started.')
    if not account.get('label') or '@' not in str(account.get('email', '')):
        raise ValueError('The generation account needs a saved Gmail address before continuing.')
    allowed = ('model', 'aspect', 'resolution', 'downloadVersion', 'seconds', 'cdp')
    data = dict(version=1, status='generated', story=str(Path(story).resolve()), story_hash=fingerprint(story),
                project=project, account_label=account['label'], account_email=account['email'], view=view,
                settings={k: settings[k] for k in allowed if k in settings}, generated_at=time.time())
    write(story, data)
    return data


def resolve_account(root, data):
    accounts = json.loads((Path(root) / 'accounts.json').read_text(encoding='utf-8')).get('accounts', [])
    email = str(data.get('account_email', '')).strip().casefold()
    matches = [a for a in accounts if str(a.get('email', '')).strip().casefold() == email and email]
    labelled = [a for a in matches if a.get('label') == data.get('account_label')]
    if len(labelled) == 1:
        return labelled[0]
    if len(matches) == 1:
        return matches[0]
    raise ValueError('Saved generation Gmail is missing or ambiguous in Accounts. Restore its saved account before resuming.')


def progress(story, phase, complete=False):
    data = load(story)
    if data is None:
        raise ValueError('Generation-only handoff is missing or this story has changed; no project/account guessed.')
    data.update(status='complete' if complete else 'finishing', last_step=phase, updated_at=time.time())
    write(story, data)
