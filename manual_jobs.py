"""Explicit existing-project finishing jobs; no generation or account failover."""
import json
import re


def entries(value, accounts, resolve_story):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError as exc:
            raise ValueError('Manual Jobs queue is invalid. Add jobs using Add to queue.') from exc
    if not isinstance(value, list) or not 1 <= len(value) <= 50:
        raise ValueError('Add one to fifty manual projects.')
    result, projects, stories = [], set(), set()
    for index, row in enumerate(value, 1):
        if not isinstance(row, dict):
            raise ValueError(f'Manual job {index}: invalid row.')
        project = str(row.get('project') or '').strip().rstrip('/')
        if not re.fullmatch(r'https://flow\.google\.com/project/[\w-]+', project):
            raise ValueError(f'Manual job {index}: enter a Flow project URL.')
        email = str(row.get('gmail') or '').strip().casefold()
        matches = [a for a in accounts if email and str(a.get('email') or '').strip().casefold() == email]
        if len(matches) != 1:
            raise ValueError(f'Manual job {index}: Gmail must match exactly one saved account in Accounts.')
        account = matches[0]
        if not account.get('label') or any(account.get(k) for k in ('paused', 'restricted', 'blocked')):
            raise ValueError(f'Manual job {index}: the selected account is unavailable.')
        source, _ = resolve_story(row.get('story') or '')
        if project in projects or str(source) in stories:
            raise ValueError('Use each project and story only once per manual queue; this prevents mixed outputs.')
        projects.add(project)
        stories.add(str(source))
        result.append(dict(project=project, gmail=account['email'], label=account['label'], story=str(source)))
    return result
