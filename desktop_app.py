"""Local desktop shell for the existing drivers. No generation engine lives here."""
from pathlib import Path
from collections import deque
import json
import hashlib
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import uuid

from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from mcp_client import MCPClient

ROOT = Path(__file__).resolve().parent
UI = ROOT / 'desktop_ui'
STATE = ROOT / 'desktop_settings.json'
WRITER_STATE = ROOT / 'desktop_writer_settings.json'
TOKEN = secrets.token_urlsafe(32)
MODELS = ['Flow', 'Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality', 'Veo 3.1 - Lite [Lower Priority]']
lock = threading.RLock()
_json_write_lock = threading.RLock()


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return {} if default is None else default


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Job output and status updates can save the same checkpoint concurrently.
    # Unique staging files also protect separate Studio processes on Windows.
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with _json_write_lock:
        try:
            temp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
            for attempt in range(10):
                try:
                    temp.replace(path)
                    break
                except PermissionError:
                    if attempt == 9:
                        raise
                    time.sleep(0.05 * (attempt + 1))
        finally:
            temp.unlink(missing_ok=True)


def story_path(value):
    path = Path(str(value)).expanduser()
    if not path.is_absolute():
        path = ROOT / path
    path = path.resolve()
    if path.suffix.lower() != '.json' or not path.is_file():
        raise ValueError('Choose an existing story JSON.')
    story = read_json(path)
    if not isinstance(story.get('scenes'), list) or not story['scenes']:
        raise ValueError('This JSON does not contain story scenes.')
    return path, story


def project_url(value, required=False):
    value = str(value or '').strip()
    if not value and not required:
        return ''
    match = re.fullmatch(r'https://flow\.google\.com/project/([\w-]+)(?:/scene/[\w-]+)?/?', value)
    if not match:
        raise ValueError('Enter a Flow project URL.')
    return 'https://flow.google.com/project/' + match[1]


def integer(value, low, high, label):
    try:
        result = int(value)
    except (ValueError, TypeError):
        raise ValueError(f'{label} must be a whole number.')
    if not low <= result <= high:
        raise ValueError(f'{label} must be between {low} and {high}.')
    return result


def reference_library_settings(legacy=None):
    legacy = legacy if legacy is not None else read_json(ROOT / 'gui_settings.json')
    for field in ('file', 'description'):
        if 'couple_sam_' + field not in legacy and 'couple_george_' + field in legacy:
            legacy['couple_sam_' + field] = legacy['couple_george_' + field]
    base = ROOT / 'Preset References'
    base.mkdir(exist_ok=True)
    folders = {}
    for preset in presets():
        folder = base / preset['id']
        folder.mkdir(exist_ok=True)
        configured = legacy.get('preset_reference_library', {}).get(preset['id'], {})
        folders[preset['id']] = configured if isinstance(configured, str) else configured.get('folder', str(folder))
    if 'preset_reference_library' not in legacy:
        import shutil
        migrated = False
        preset_id = legacy.get('gen_preset', 'relationship-dialogue-real')
        if preset_id not in ('relationship-dialogue', 'relationship-dialogue-real', 'relationship-dialogue-ghibli', 'relationship-dialogue-3d', 'relationship-dialogue-colorful-cartoon'):
            preset_id = 'relationship-dialogue-real'
        for name in ('Sarah', 'SAM'):
            source = Path(str(legacy.get('couple_' + name.lower() + '_file', '')))
            if source.is_file() and source.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp'):
                target = base / preset_id / (name + source.suffix.lower())
                if not target.exists():
                    shutil.copy2(source, target)
                migrated = True
        if migrated:
            legacy['preset_reference_library'] = {preset_id: {'folder': folders[preset_id]}}
            save_json(ROOT / 'gui_settings.json', legacy)
    return dict(root=str(base), folders=folders, modes={mode: legacy.get('preset_reference_modes', {}).get(mode, True)
                for mode in ('agent', 'ingredients', 'omni')})


def presets():
    result = []
    for filename, group in [('styles.json', 'Classic'), ('genai_styles.json', 'GENAI')]:
        data = read_json(ROOT / filename)
        for p in data.get('styles', data.get('presets', [])):
            if p.get('id'):
                result.append(dict(id=p['id'], name=p.get('name', p.get('label', p['id'])), group=group))
    return result


def validate_download_project(story_file, project):
    match = re.search(r'/project/([\w-]+)', project or '')
    if not match:
        return
    selected = Path(story_file).resolve()
    owners = []
    for checkpoint in selected.parent.parent.glob('*/agent_batches_' + match[1] + '.json'):
        state = read_json(checkpoint)
        if state.get('project') != match[1] or not state.get('fingerprint'):
            continue
        for candidate in checkpoint.parent.glob('*_story.json'):
            if hashlib.sha256(candidate.read_bytes()).hexdigest() == state['fingerprint']:
                owners.append(candidate.resolve())
    if selected in owners or len(owners) != 1:
        return
    owner = owners[0]
    data = read_json(owner)
    raise ValueError(f'Story/project mismatch: this project belongs to "{data.get("title", owner.stem)}" ({len(data.get("scenes", []))} clips). Select that story before downloading: {owner}')


def active_account():
    data = read_json(ROOT / 'accounts.json')
    accounts = data.get('accounts', [])
    index = data.get('current', 0)
    return accounts[index].get('label', '') if accounts and 0 <= index < len(accounts) else ''


def command(filename, *args):
    return ['node', str(ROOT / filename), *map(str, args)]


GLOBAL_WORKFLOW_DEFAULTS = dict(rotateQueueAccounts=False, videosPerAccount=2,
    activityCooldownEnabled=True, activityCooldownSeconds=60, activityMaxAttempts=3,
    videoModel='Omni 1.1 Flash',videoAspect='9:16',videoResolution='360p',
    videoDownloadVersion='upscaled',videoSeconds=8,automationCdp=9222,agentPromptsPerBatch=5)


def global_workflow_settings(values=None):
    supplied = read_json(ROOT / 'gui_settings.json').get('workflow_globals', {}) if values is None else values
    if not isinstance(supplied, dict):raise ValueError('Invalid global workflow settings.')
    cfg = dict(GLOBAL_WORKFLOW_DEFAULTS, **{k:v for k,v in supplied.items() if k in GLOBAL_WORKFLOW_DEFAULTS})
    for key in ('rotateQueueAccounts','activityCooldownEnabled'):
        if not isinstance(cfg[key], bool):raise ValueError(f'{key} must be enabled or disabled.')
    for key,low,high in [('videosPerAccount',1,50),('activityCooldownSeconds',60,3600),('activityMaxAttempts',1,3),('videoSeconds',4,10),('automationCdp',1024,65535),('agentPromptsPerBatch',1,1000000)]:
        value=integer(cfg[key],low,high,key)
        if isinstance(cfg[key],bool) or float(cfg[key])!=value:raise ValueError(f'{key} must be a whole number.')
        cfg[key]=value
    for key,choices in [('videoModel',MODELS),('videoAspect',('Flow','9:16','16:9','1:1')),('videoResolution',('Flow','360p','720p')),('videoDownloadVersion',('original','upscaled'))]:
        if cfg[key] not in choices:raise ValueError(f'Invalid global {key}.')
    if cfg['videoSeconds'] not in (4,6,8,10):raise ValueError('Clip seconds must be 4, 6, 8 or 10.')
    return cfg


def global_workflow_payload(payload):
    cfg=global_workflow_settings(payload.get('_globalWorkflow'))
    result=dict(payload, _globalWorkflow=cfg, rotateQueueAccounts=cfg['rotateQueueAccounts'], videosPerAccount=cfg['videosPerAccount'])
    if payload.get('view') in ('agent','ingredients','omni'):
        result.update(model=cfg['videoModel'],aspect=cfg['videoAspect'],resolution=cfg['videoResolution'],downloadVersion=cfg['videoDownloadVersion'],seconds=cfg['videoSeconds'],cdp=cfg['automationCdp'],manualBatchSize=cfg['agentPromptsPerBatch'])
    return result


def plan_action(action, p):
    if action == 'edit_video':
        import video_editing
        source = video_editing.media_path(p.get('video', ''))
        cfg = video_editing.settings(p.get('editingSettings'))
        return 'editing', [('request', ('video_editing.py', dict(video=str(source), settings=cfg)))]
    if action == 'reverse_video':
        from reverse_video_desktop import request_payload
        return 'writer', [('request', ('reverse_video_engine.js', request_payload(ROOT, p)))]
    if action == 'generate_queue':
        p=global_workflow_payload(p)
        if p.get('view') not in ('agent', 'ingredients', 'omni'):
            raise ValueError('Choose a video workflow.')
        selected = p.get('queue', [])
        if not isinstance(selected, list) or not selected or len(selected) > 50:
            raise ValueError('Select one to fifty saved stories for the batch.')
        paths = [str(story_path(item)[0]) for item in selected]
        if len(set(paths)) != len(paths):
            raise ValueError('The queue contains duplicate stories.')
        allocations = []
        if p.get('rotateQueueAccounts'):
            quota = integer(p.get('videosPerAccount', 2), 1, 50, 'Videos per account')
            if float(p.get('videosPerAccount', 2)) != quota:raise ValueError('Videos per account must be a whole number.')
            store = read_json(ROOT / 'accounts.json');accounts = store.get('accounts', [])
            start = int(store.get('current', 0)) if accounts else 0
            month = time.strftime('%Y-%m')
            ordered = accounts[start:] + accounts[:start]
            available = [a for a in ordered if not a.get('paused') and not a.get('restricted') and not a.get('blocked')
                and (a.get('clips_used', 0) if a.get('clips_month') == month else 0) < a.get('max_clips', 100)]
            if not available:
                raise ValueError('No eligible saved account is available. Nothing started.')
            allocations = [available[(i//quota)%len(available)]['label'] for i in range(len(paths))]
        operations = []
        for index, path in enumerate(paths):
            if allocations:
                operations.append(('cli', command('queue_account.js', '--label', allocations[index], '--cdp', p.get('cdp', 9222))))
            inputs = dict(p, story=path, _queueAccount=allocations[index] if allocations else '', project='', newProject=True, reuseRefs=False,
                          genRefs=bool(p.get('batchGenRefs', True) or p.get('genRefs')), **{'from':1, 'to':''})
            _, steps = plan_action('generate', inputs)
            operations.extend(steps)
        return 'flow', operations
    """Validate UI input and create allowlisted operations, never arbitrary commands."""
    if action == 'import_script':
        text = str(p.get('readyScript', '')).strip()
        if not text:
            raise ValueError('Paste a complete ready script with Title:, Preset:, Clip N: and the selected preset’s dialogue or narration/visual fields.')
        if p.get('preset') not in {x['id'] for x in presets()}:
            raise ValueError('Select a preset.')
        aspect = p.get('aspect', '9:16')
        if aspect not in ('Flow', '9:16', '16:9', '1:1'):
            raise ValueError('Invalid aspect ratio.')
        return 'writer', [('request', ('import_ready_script.js', dict(text=text, preset=p['preset'], aspect=aspect,
            seconds=integer(p.get('seconds', 8), 4, 10, 'Clip duration'),
            strict8x8=bool(p.get('strictZack8x8', False)))))]
    if action in ('write', 'finalize', 'aistudio'):
        if action == 'aistudio':
            return 'writer', [('cli', command('ask_web.js', '--status', '--launch'))]
        if action == 'finalize':
            analysis = Path(str(p.get('analysis', ''))).resolve()
            if not analysis.is_file() or analysis.suffix != '.json':
                raise ValueError('Select a saved analysis JSON.')
            return 'writer', [('cli', command('finalize_saved_analysis.js', analysis))]
        preset = str(p.get('preset', ''))
        if preset not in {x['id'] for x in presets()}:
            raise ValueError('Select a preset.')
        seconds = integer(p.get('seconds', 8), 4, 15, 'Clip duration')
        clips = integer(p.get('clips', 8), 1, 500, 'Clip count')
        transport = p.get('transport', 'web')
        if transport not in ('web', 'api', 'auto'):
            raise ValueError('Choose browser or API writing.')
        args = dict(preset=preset, seconds=seconds, duration=clips * seconds, clips=clips,
                    aspect=p.get('aspect', '9:16'), transport=transport,
                    match_ref=bool(p.get('matchSource', True)), reuse=True,
                    generate=False, submit=False, download=False, join=False,
                    generate_refs=False, new_project=False)
        if p.get('geminiModel'):
            args['model'] = str(p['geminiModel'])
        if p.get('source') == 'links':
            links = [x.strip() for x in str(p.get('links', '')).splitlines() if x.strip()]
            if not links or any(not re.fullmatch(r'https?://\S+', x) for x in links):
                raise ValueError('Add video links, one per line.')
            args['references'] = links
        else:
            from story_ideas import parse_ideas
            ideas = [dict(item, preset=item.get('preset') or preset, duration=clips * seconds)
                     for item in parse_ideas(p.get('ideas', ''))]
            if not ideas:
                raise ValueError('Add a title and story details.')
            args['ideas'] = ideas
            args['match_ref'] = False
        if args['aspect'] not in ('Flow', '9:16', '16:9', '1:1'):
            raise ValueError('Invalid aspect ratio.')
        return 'writer', [('mcp', ('batch_pipeline', args))]
    if action.startswith('account_'):
        operation = action.removeprefix('account_')
        if operation not in ('add', 'use', 'pause', 'resume', 'reset', 'remove', 'move_up', 'move_down'):
            raise ValueError('Unknown account operation.')
        label = str(p.get('label', '')).strip()
        if not label:
            raise ValueError('Enter an account label.')
        cmd = command('account_manager.js', operation, '--label', label)
        if operation == 'add':
            cmd += ['--email', str(p.get('email', '')), '--max-clips', str(integer(p.get('maxClips', 100), 1, 100000, 'Monthly clip limit'))]
        if operation == 'use':
            cmd += ['--cdp', str(integer(p.get('cdp', 9222), 1024, 65535, 'Browser port'))]
        if operation == 'remove' and not p.get('confirmed'):
            raise ValueError('Confirm account removal first.')
        return 'flow', [('cli', cmd)]
    path, story = story_path(p.get('story', ''))
    view = p.get('view', 'agent')
    if view not in ('agent', 'ingredients', 'omni'):
        raise ValueError('Invalid workflow.')
    port = integer(p.get('cdp', 9222), 1024, 65535, 'Browser port')
    aspect = p.get('aspect', '9:16')
    if aspect not in ('Flow', '9:16', '16:9', '1:1'):
        raise ValueError('Invalid aspect ratio.')
    model = p.get('model', 'Omni 1.1 Flash')
    if model not in MODELS:
        raise ValueError('Select a supported video model.')
    resolution = p.get('resolution', '360p')
    download_version = p.get('downloadVersion', 'upscaled')
    if download_version not in ('upscaled', 'original'):
        raise ValueError('Choose Upscaled or Original downloads.')
    if resolution not in ('Flow', '360p', '720p'):
        raise ValueError('Invalid resolution.')
    seconds = integer(p.get('seconds', story.get('scene_seconds', 8)), 1, 15, 'Clip duration')
    total = len(story['scenes'])
    first = integer(p.get('from', 1), 1, total, 'First scene')
    last = integer(p.get('to', total) or total, first, total, 'Last scene')
    project = project_url(p.get('project'), required=action in ('manual', 'retry_failed', 'delete', 'download'))
    if action == 'download':
        validate_download_project(path, project)
    if action in ('generate', 'refs') and p.get('usePresetRefs', reference_library_settings()['modes'].get(view, True)):
        p = dict(p, genRefs=True, reuseRefs=False)
    base = ['--cdp', str(port)]
    if project:
        base += ['--project-url', project]
    if action == 'build':
        return 'flow', [('cli', command('story_to_agent_prompt.js', path, '--aspect', aspect, '--seconds', seconds))]
    if action in ('join', 'order', 'fix_join', 'export_excel'):
        if action == 'export_excel':
            return 'flow', [('cli', [sys.executable, str(ROOT / 'story_to_excel.py'), str(path)])]
        if action == 'order':
            return 'flow', [('cli', command('order_clips_by_dialogue.js', path, '--clips', path.parent / 'clips', '--write'))]
        if action == 'fix_join':
            return 'flow', [('cli', command('fix_order_and_join.js', path))]
        return 'flow', [('cli', command('join_clips.js', path.parent / 'clips'))]
    if action == 'delete':
        if not p.get('confirmed'):
            raise ValueError('Confirm moving all project videos to Trash first.')
        return 'flow', [('request', ('delete_project_video_clips.js', dict(project=project, story=str(path), cdp=port, confirmed=True)))]
    if action == 'retry_failed':
        retry = command('agent_mode.js', '--retry-failed-only', '--expected', total,
                        '--retry-rounds', 8, '--retry-watch', 90, '--refs', path, *base)
        match = re.search(r'/project/([A-Za-z0-9_-]+)', project or '')
        if match:
            submission = path.parent / f'agent_batches_{match.group(1)}.json.submission.json'
            if submission.is_file():
                retry += ['--submission-file', str(submission)]
        return 'flow', [('cli', retry)]
    if action == 'manual':
        selection = str(p.get('selection', '')).strip()
        batch = p.get('selectionType') == 'batch'
        batch_size = integer(p.get('manualBatchSize', 5), 1, 1000000, 'Prompts per batch') if batch else 5
        if batch:
            if isinstance(p.get('manualBatchSize'), bool) or float(p.get('manualBatchSize', 5)) != batch_size:
                raise ValueError('Prompts per batch must be a positive whole number.')
            integer(selection, 1, (total + batch_size - 1) // batch_size, 'Batch number')
        else:
            for part in re.split(r'[\s,]+', selection):
                if not re.fullmatch(r'\d+(?:-\d+)?', part):
                    raise ValueError('Use clip numbers such as 2,8,6 or 3-5.')
                ends = list(map(int, part.split('-')))
                integer(ends[0], 1, total, 'Clip number')
                integer(ends[-1], ends[0], total, 'Clip number')
        preparation = [('cli', command('generate_refs.js', '--story', path, *base))] if p.get('usePresetRefs', True) else []
        return 'flow', preparation + [('cli', command('agent_manual_generation.js', '--story', path,
                '--batch' if batch else '--clips', selection, '--batch-size', batch_size, '--watch', 1800,
                '--aspect', aspect, '--video-model', model, '--video-resolution', resolution,
                '--scene-seconds', seconds, *base))]
    if view == 'omni':
        if seconds != 8:
            raise ValueError('The current Single Clip Omni driver uses 8-second clips.')
        if not re.search(r'Omni.*Flash', model, re.I):
            raise ValueError('Single Clip Omni requires Omni Flash.')
        req = dict(story=str(path), project=project, cdp=port, model=model, aspect=aspect,
                   resolution=resolution, downloadVersion=download_version, **{'from': first, 'to': last},
                   newProject=bool(p.get('newProject')), reuseRefs=bool(p.get('reuseRefs')),
                   genRefs=bool(p.get('genRefs')) and not p.get('reuseRefs'),
                   savedCouple=bool(p.get('savedCouple', read_json(ROOT / 'gui_settings.json').get('omni_saved_couple', False))), simple=bool(p.get('simple', True)),
                   refsOnly=action == 'refs', download=bool(p.get('download', True)), join=bool(p.get('join')))
        if p.get('_queueAccount') or active_account():
            req['account'] = p.get('_queueAccount') or active_account()
        if action == 'download':
            req.update(downloadOnly=True, newProject=False, genRefs=False, reuseRefs=True)
        elif action not in ('generate', 'refs'):
            raise ValueError('Unknown Omni action.')
        if req['resolution'] == 'Flow':
            raise ValueError('Choose 360p or 720p for Omni.')
        return 'flow', [('request', ('single_clip_omni.js', req))]
    if action == 'download':
        cmd = command('agent_download.js', '--out', path.parent / 'clips', '--story', path,
                      '--expected', total, '--reverse', *base)
        cmd.append('--original' if download_version == 'original' else '--upscaled')
        return 'flow', [('cli', cmd)]
    if view == 'ingredients':
        cmd = command('veo3_flow_new_ui.js', path, '--from', first, '--to', last,
                      '--video-model', model, '--aspect', aspect, *base)
        if p.get('_queueAccount') or active_account():
            cmd += ['--account', p.get('_queueAccount') or active_account()]
        resume = first > 1 and action != 'refs'
        if resume and not project:
            raise ValueError('Resuming Ingredients requires the existing project URL.')
        for condition, flag in [(action != 'refs', '--auto-start'),
                                (action == 'refs', '--refs-only'),
                                (p.get('newProject') and not resume, '--new-project'),
                                (p.get('reuseRefs'), '--skip-refs'),
                                (p.get('genRefs') and not resume, '--gen-refs'),
                                (p.get('refsOnClip1', True), '--refs-on-clip1'),
                                (p.get('join') and action != 'refs', '--join'),
                                (not p.get('download', True) and not p.get('join'), '--no-download')]:
            if condition:
                cmd.append(flag)
        return 'flow', [('cli', cmd)]
    if action == 'refs':
        return 'flow', [('cli', command('generate_refs.js', '--story', path, *base))]
    if action != 'generate':
        raise ValueError('Unknown action.')
    agent_size = integer(p.get('manualBatchSize', 5), 1, 1000000, 'Prompts per batch')
    if isinstance(p.get('manualBatchSize'), bool) or float(p.get('manualBatchSize', 5)) != agent_size:
        raise ValueError('Prompts per batch must be a positive whole number.')
    if not p.get('newProject'):
        # Use the same explicit-project CLI as the classic Agent tab. The full
        # pipeline's start phase discovers its project instead of taking this URL.
        operations = [('cli', command('story_to_agent_prompt.js', path, '--aspect', aspect, '--seconds', seconds))]
        if p.get('genRefs') and not p.get('reuseRefs'):
            operations.append(('cli', command('generate_refs.js', '--story', path, *base)))
        driver = command('agent_batch_run.js', '--batch-size', agent_size, '--file', path.parent / 'agent_prompt.txt', '--refs', path,
                         '--watch', 1800, '--aspect', aspect, '--video-model', model,
                         '--video-resolution', resolution, '--scene-seconds', seconds, '--auto-approve', *base)
        if p.get('reuseRefs') or p.get('genRefs'):
            driver.append('--no-upload-refs')
        operations.append(('cli', driver))
        if p.get('download', True) or p.get('join'):
            _, download = plan_action('download', dict(p, story=str(path)))
            operations.extend(download)
        if p.get('join'):
            _, order = plan_action('order', dict(p, story=str(path)))
            _, join = plan_action('join', dict(p, story=str(path)))
            operations.extend(order + join)
        return 'flow', operations
    args = dict(stories=[str(path)], start_phase='clips' if p.get('reuseRefs') and project else 'start',
                project_url=project, generate=True, submit=True, auto_approve=True, clip_batch_size=agent_size,
                video_model=model, video_resolution=resolution, download_version=download_version, aspect=aspect, seconds=seconds,
                cdp=port, watch=1800, new_project=bool(p.get('newProject')),
                generate_refs=bool(p.get('genRefs')), no_upload_refs=bool(p.get('reuseRefs')),
                download=bool(p.get('download', True) or p.get('join')), join=bool(p.get('join')))
    return 'flow', [('mcp', ('batch_pipeline', args))]


AUTO_RETRY_SECONDS = 8


def automatic_retry_allowed(action, lane):
    # Use the same action allowlist as manual Retry / Continue. Any error in
    # these workflows is eligible; checkpoint planning still prevents replay
    # of destructive actions or an unverified generation submission.
    return lane in {'flow', 'writer'} and action in RETRY_ACTIONS


def retry_missing_agent_batch(record, remaining):
    """When Join/Order failed, resume a checkpointed missing Agent batch first.

    A join error is downstream evidence, not a reason to loop the join command
    while the story checkpoint still has an unsubmitted/incomplete batch.
    The Agent driver performs the twice-confirmed source preflight and submits
    only missing scenes; following operations run only after it verifies them.
    """
    if record.get('action') != 'generate' or record.get('payload', {}).get('view') != 'agent' or not remaining:
        return None
    kind, spec = remaining[0]
    if kind != 'cli' or not any(str(arg).endswith(('join_clips.js', 'order_clips_by_dialogue.js')) for arg in spec):
        return None
    payload = record.get('payload', {})
    story = Path(str(payload.get('story', ''))).expanduser()
    project = project_url(payload.get('project'))
    match = re.search(r'/project/([A-Za-z0-9_-]+)$', project)
    if not story.is_file() or not match:
        return None
    story = story.resolve()
    project_id = match.group(1)
    state_file = story.parent / f'agent_batches_{project_id}.json'
    submission = Path(str(state_file) + '.submission.json')
    if not state_file.is_file() or not submission.is_file():
        return None
    try:
        data = read_json(state_file)
        story_data = read_json(story)
        story_hash = hashlib.sha256(story.read_bytes()).hexdigest()
        intent = read_json(submission)
    except OSError:
        return None
    total = len(story_data.get('scenes', []))
    if (data.get('project') != project_id or data.get('fingerprint') != story_hash
            or data.get('total') != total or not isinstance(data.get('pending'), dict)
            or data['pending'].get('from') != intent.get('from')
            or data['pending'].get('to') != intent.get('to')
            or intent.get('fingerprint') != story_hash):
        return None

    port = str(payload.get('cdp', 9222))
    recovery = command('agent_mode.js', '--retry-failed-only', '--expected', total,
                       '--retry-rounds', 0, '--retry-watch', 90, '--watch', 1800,
                       '--refs', story, '--submission-file', submission,
                       '--project-url', project, '--cdp', port,
                       '--aspect', payload.get('aspect', '9:16'),
                       '--video-model', payload.get('model', 'Omni 1.1 Flash'),
                       '--video-resolution', payload.get('resolution', '360p'),
                       '--scene-seconds', payload.get('seconds', 8))
    _, download_ops = plan_action('download', {**payload, 'story': str(story), 'project': project, 'view': 'agent'})
    _, order_ops = plan_action('order', {**payload, 'story': str(story), 'project': project, 'view': 'agent'})
    _, join_ops = plan_action('join', {**payload, 'story': str(story), 'project': project, 'view': 'agent'})
    return [('cli', recovery), *download_ops, *order_ops, *join_ops]


def retry_step_name(recent, phase):
    match = re.findall(r'FAILED at ([a-z_]+)', recent, re.I)
    if match:
        return match[-1]
    if re.search(r'No completed reference image|reference preparation', recent, re.I):
        return 'reference preparation'
    return phase


class Job:
    def __init__(self, action, payload, lane, operations):
        self.id = uuid.uuid4().hex
        self.action, self.payload, self.lane, self.operations = action, dict(payload), lane, operations
        self.payload.setdefault('_globalWorkflow',global_workflow_settings())
        if lane == 'flow' and '_editingSettings' not in self.payload:
            import video_editing
            self.payload['_editingSettings'] = video_editing.settings()
        self.status = 'running'
        self.created = time.time()
        self.finished = None
        self.proc = None
        self.client = None
        self.stopped = False
        self._stop_event = threading.Event()
        self.auto_retry_count = 0
        self.logs = deque(maxlen=4000)
        self.sequence = 0
        self.operation_index = 0
        self.phase = 'starting'
        self.operation_projects = {}
        self.operation_phases = {}

    def save_progress(self):
        view = self.payload.get('view', 'writer' if self.lane == 'writer' else '')
        if view in ('writer', 'agent', 'ingredients', 'omni', 'reverse') and self.action in RETRY_ACTIONS:
            save_json(ROOT / 'logs' / 'desktop' / f'last_{view}_job.json',
                      dict(id=self.id, action=self.action, payload=self.payload, lane=self.lane,
                           operations=self.operations, operation_index=self.operation_index,
                           operation_projects=self.operation_projects, operation_phases=self.operation_phases,
                           phase=self.phase, status=self.status, auto_retry_count=self.auto_retry_count))

    def log(self, line):
        # Driver output may contain keys. Never display complete tokens in the UI.
        line = re.sub(r'AIza[\w-]{35}', '[API key hidden]', str(line))
        for key in read_json(ROOT / 'gui_settings.json').get('gemini_api_keys', []):
            if isinstance(key, str) and len(key) > 10:
                line = line.replace(key, '[API key hidden]')
        match = re.search(r'https://flow\.google\.com/project/([\w-]+)', line)
        changed = False
        if re.search(r'generating the reference images|FAILED at generate_refs', line, re.I):
            self.operation_phases[str(self.operation_index)] = 'refs'
            changed = True
        elif re.search(r'reference images done|driving Flow|Agent clip batch|FAILED at run_agent', line, re.I):
            self.operation_phases[str(self.operation_index)] = 'clips'
            changed = True
        if match and ('PROJECT_URL:' in line or re.search(r'\bproject\s*(?:->|:)', line, re.I)):
            self.payload['project'] = 'https://flow.google.com/project/' + match[1]
            self.operation_projects[str(self.operation_index)] = self.payload['project']
            changed = True
        if re.search(r'Download >|Downloading|downloads? finished|upscaled download', line, re.I) and self.phase != 'download':
            self.phase = 'download'
            changed = True
        if changed:
            self.save_progress()
        with lock:
            now = time.time()
            stamp = time.strftime('%H:%M:%S', time.localtime(now))
            # MCP results can contain an entire multiline batch summary. Stamp
            # every physical line, including headings, failure and retry lines.
            entries = line.splitlines() or ['']
            folder = ROOT / 'logs' / 'desktop'
            folder.mkdir(parents=True, exist_ok=True)
            with (folder / (self.id + '.log')).open('a', encoding='utf-8') as stream:
                for entry in entries:
                    timestamped = f'[{stamp}] {entry}'
                    self.sequence += 1
                    self.logs.append(dict(id=self.sequence, text=timestamped, time=now))
                    stream.write(timestamped + '\n')

    def summary(self):
        return dict(id=self.id, action=self.action, lane=self.lane, status=self.status,
                    created=self.created, finished=self.finished, phase=self.phase,
                    operation=self.operation_index+1, auto_retry_count=self.auto_retry_count, latest=self.logs[-1]['text'] if self.logs else '')

    def stop(self):
        with lock:
            self.stopped = True
            self._stop_event.set()
            proc, client = self.proc, self.client
        if client:
            client.stop()
        if proc and proc.poll() is None:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), timeout=15)
            else:
                proc.terminate()
        self.log('Stop requested. Saved checkpoints are retained.')

    def reference_environment(self):
        env = os.environ.copy()
        mode = self.payload.get('view', 'agent')
        enabled = self.payload.get('usePresetRefs', reference_library_settings()['modes'].get(mode, True))
        env['VEO_PRESET_REFS'] = '1' if enabled else '0'
        env['VEO_PYTHON'] = sys.executable
        policy=self.payload.get('_globalWorkflow',GLOBAL_WORKFLOW_DEFAULTS)
        env['VEO_ACTIVITY_WAIT_SECONDS']=str(policy['activityCooldownSeconds'])
        env['VEO_ACTIVITY_MAX_ATTEMPTS']=str(policy['activityMaxAttempts'])
        env['VEO_ACTIVITY_COOLDOWN_ENABLED']='1' if policy['activityCooldownEnabled'] else '0'
        env['VEO_ACTIVITY_COOLDOWN_ELAPSED'] = '1' if self.payload.get('_unusualActivityFailures') else '0'
        if self.payload.get('_editingSettings') is not None:
            env['VEO_EDITING_SETTINGS'] = json.dumps(self.payload['_editingSettings'])
        return env

    def _run_operations(self):
        # On resume, restore only the originally assigned account. Never choose
        # another account in response to an error or platform restriction.
        if self.action == 'generate_queue' and self.payload.get('rotateQueueAccounts') and self.operation_index:
            assigned = next((spec for kind,spec in reversed(self.operations[:self.operation_index])
                if kind == 'cli' and len(spec)>1 and str(spec[1]).endswith('queue_account.js')), None)
            if assigned and not self.stopped:
                checked = subprocess.run(assigned,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',
                    timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                for line in (checked.stdout+checked.stderr).splitlines():self.log(line)
                if checked.returncode:raise RuntimeError('FLOW_REVIEW_REQUIRED: Could not restore the assigned queue account. No alternate account selected.')
        for index in range(self.operation_index, len(self.operations)):
            kind, spec = self.operations[index]
            self.operation_index = index
            self.phase = 'running operation ' + str(index + 1)
            self.save_progress()
            if self.action == 'generate_queue':
                story = spec[1].get('story') if kind == 'request' else spec[1].get('stories', [''])[0] if kind == 'mcp' else next((str(x) for x in spec if str(x).endswith('.json')), '')
                self.log('STORY QUEUE: starting ' + str(story))
            if self.stopped:
                break
            if kind == 'request':
                filename, request = spec
                requestfile = ROOT / 'logs' / 'desktop' / (self.id + '.json')
                save_json(requestfile, request)
                kind, spec = 'cli', ([sys.executable, str(ROOT / filename), str(requestfile)] if filename.endswith('.py') else command(filename, requestfile))
            if kind == 'cli':
                self.log('Starting ' + Path(spec[1]).name)
                with lock:
                    if self.stopped:
                        break
                    self.proc = subprocess.Popen(spec, cwd=ROOT, stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace',
                        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), env=self.reference_environment())
                for line in self.proc.stdout:
                    self.log(line.rstrip())
                code = self.proc.wait()
                self.proc = None
                if code and not self.stopped:
                    raise RuntimeError(f'Driver exited with code {code}. See the log above.')
            else:
                name, args = spec
                with lock:
                    if self.stopped:
                        break
                    self.client = MCPClient(str(ROOT / 'mcp_server.js'), cwd=str(ROOT), log=self.log, env=self.reference_environment())
                self.client.start()
                if self.stopped:
                    self.client.stop()
                    break
                result = self.client.call_tool(name, args)
                self.log(result['text'])
                self.client.stop()
                self.client = None
                if result['isError'] and not self.stopped:
                    raise RuntimeError('The workflow reported an error. See the log above.')

    def run(self):
        try:
            if self.action == 'generate_queue':
                on = self.payload.get('rotateQueueAccounts', False)
                self.log('ACCOUNT ALLOCATION: ' + (f"ON; {self.payload.get('videosPerAccount', 2)} videos per account; wraps to first eligible account." if on else 'OFF; using the current account. Videos-per-account value is inactive.'))
            while not self.stopped:
                attempt_start = self.sequence
                try:
                    self._run_operations()
                    self.status = 'stopped' if self.stopped else 'completed'
                    break
                except Exception as exc:
                    self.log(str(exc))
                    recent = '\n'.join(row['text'] for row in self.logs if row['id'] > attempt_start)
                    if self.stopped:
                        self.status = 'stopped'
                        break
                    if self.action == 'import_script' and re.search(r'IMPORT_VALIDATION_FAILED|READY SCRIPT IMPORT FAILED:.*(?:Unrecognised line|Unknown script field|shot timings|declared duration|no clips|requires Narration)', recent, re.I):
                        self.log('Automatic import retry stopped: this script needs correction. The story/clip/line details are shown above. No video generation was started.')
                        self.status = 'failed'
                        break
                    unusual = bool(re.search(r'unusual\s+activity|UNUSUAL_ACTIVITY', recent, re.I))
                    if unusual:
                        context = f'{self.operation_index}:{self.operation_phases.get(str(self.operation_index), "")}'
                        history = self.payload.setdefault('_unusualActivityFailures', {})
                        history[context] = int(history.get(context, 0)) + 1
                        attempts = history[context]
                        policy=self.payload['_globalWorkflow']
                        limit=policy['activityMaxAttempts']
                        self.log(f'FLOW_UNUSUAL_ACTIVITY: failure {attempts}/{limit}; completed work preserved; no account switching.')
                        if not policy['activityCooldownEnabled'] or attempts >= limit or 'UNUSUAL_ACTIVITY_BLOCKED' in recent:
                            self.log('Unusual-activity retry limit reached. Job stopped for Flow review; no new project or account will be used.')
                            self.status = 'failed'
                            break
                    if (not unusual or re.search(r'policy-blocked|content policy|unresolved scene order|multiple completed video assets', recent, re.I)) and re.search(r'FLOW_REVIEW_REQUIRED:|RECOVERY_REVIEW_REQUIRED:', recent):
                        self.log('Automatic retry stopped: this step needs review, so reopening the same project cannot resolve it. Completed clips and downloads are preserved.')
                        self.status = 'failed'
                        break
                    if not automatic_retry_allowed(self.action, self.lane):
                        self.status = 'failed'
                        break
                    if self.action == 'import_script' and self.auto_retry_count >= 3:
                        self.log('Automatic import retry limit reached after 3 retries. Correct the input or resolve the local file/runtime error, then retry manually.')
                        self.status = 'failed'
                        break
                    # Use the same checkpoint planner as both Retry / Continue
                    # controls. Batch identity and later stories stay intact.
                    record = dict(id=self.id, action=self.action, payload=self.payload,
                                  lane=self.lane, operations=self.operations,
                                  operation_index=self.operation_index,
                                  operation_projects=self.operation_projects,
                                  operation_phases=self.operation_phases,
                                  phase=self.phase, status='failed')
                    if self.client:
                        self.client.stop()
                        self.client = None
                    remaining = retry_plan(record)
                    self.operations[self.operation_index:] = remaining
                    self.auto_retry_count += 1
                    mode = 'batch' if self.action == 'generate_queue' else 'single video'
                    step = retry_step_name(recent, self.phase)
                    self.phase = 'waiting to retry ' + step
                    retry_delay = self.payload['_globalWorkflow']['activityCooldownSeconds'] if unusual else min(60, AUTO_RETRY_SECONDS * 2 ** (self.auto_retry_count - 1)) if self.action == 'import_script' else AUTO_RETRY_SECONDS
                    self.log(f'Automatic Retry / Continue ({mode}) #{self.auto_retry_count}: {step} failed; resuming the saved step in {retry_delay} seconds. Completed clips and downloads are preserved. Press Stop to cancel.')
                    self.save_progress()
                    if self._stop_event.wait(retry_delay):
                        self.status = 'stopped'
                        break
            if self.stopped:
                self.status = 'stopped'
        except Exception as exc:
            self.log(str(exc))
            self.status = 'stopped' if self.stopped else 'failed'
        finally:
            if self.client:
                self.client.stop()
                self.client = None
            self.finished = time.time()
            self.log({'completed': 'Workflow completed successfully.', 'failed': 'Workflow stopped with an error.', 'stopped': 'Workflow stopped by user.'}.get(self.status, self.status))
            save_json(ROOT / 'logs' / 'desktop' / (self.id + '.result.json'), self.summary())
            self.save_progress()


jobs = {}
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
RETRY_ACTIONS = {'reverse_video', 'write', 'import_script', 'finalize', 'generate', 'generate_queue', 'refs', 'download', 'order', 'join', 'fix_join', 'build', 'export_excel', 'retry_failed'}


def retry_plan(record):
    if record.get('action') not in RETRY_ACTIONS:
        raise ValueError('This operation cannot be repeated safely. Use its dedicated control.')
    if record.get('status') == 'completed':
        raise ValueError('The last workflow already completed; nothing to retry.')
    operations = record.get('operations', [])
    cursor = record.get('operation_index', 0)
    if not isinstance(cursor, int) or cursor < 0 or cursor >= len(operations):
        raise ValueError('Saved workflow step is unavailable.')
    remaining = json.loads(json.dumps(operations[cursor:]))
    missing_batch_retry = retry_missing_agent_batch(record, remaining)
    if missing_batch_retry:
        return missing_batch_retry
    for offset, (kind, spec) in enumerate(remaining):
        project = record.get('operation_projects', {}).get(str(cursor+offset), '') if record.get('action') == 'generate_queue' else record.get('payload', {}).get('project', '')
        reference_failed = record.get('operation_phases', {}).get(str(cursor+offset)) == 'refs'
        if offset == 0 and str(cursor+offset) not in record.get('operation_phases', {}) and re.fullmatch(r'[0-9a-f]{32}', record.get('id', '')):
            logfile = ROOT / 'logs' / 'desktop' / (record['id'] + '.log')
            if logfile.is_file():
                current_log = logfile.read_text(encoding='utf-8', errors='replace').rsplit('STORY QUEUE: starting', 1)[-1]
                reference_failed = bool(re.search(r'FAILED at generate_refs', current_log))
        # Repair old queue requests that ignored the enabled general reference switch.
        # Only the original skipped-preparation request needs correction; once refs
        # were requested, normal phase checkpoints govern subsequent retries.
        if (kind == 'mcp' and record.get('action') == 'generate_queue'
                and spec[1].get('generate') and not spec[1].get('generate_refs')
                and spec[1].get('new_project')
                and record.get('payload', {}).get('genRefs')):
            reference_failed = True
            spec[1]['generate_refs'] = True
        if kind == 'mcp' and spec[1].get('generate') and (project or record.get('action') != 'generate_queue'):
            if len(spec[1].get('stories', [])) != 1 or not project:
                raise ValueError('This pipeline needs its saved single-story project to resume safely; no generation repeated.')
            spec[1].update(project_url=project, new_project=False,
                           start_phase='start' if reference_failed else 'clips',
                           generate_refs=reference_failed, no_upload_refs=True)
        if kind == 'request' and project:
            spec[1]['project'] = project
            spec[1]['newProject'] = False
        elif kind == 'cli' and project and '--new-project' in spec:
            spec.remove('--new-project')
            if '--project-url' not in spec:
                spec += ['--project-url', project]
        if kind == 'cli' and any(str(x).endswith('veo3_flow_new_ui.js') for x in spec) and '--refs-only' not in spec and '--export-only' not in spec and (project or record.get('action') != 'generate_queue'):
            if not project:
                raise ValueError('The Ingredients retry needs the saved project URL; no generation was repeated.')
            if '--project-url' not in spec:
                spec += ['--project-url', project]
            for flag in ('--new-project', '--gen-refs'):
                if flag in spec:
                    spec.remove(flag)
            spec.append('--resume-auto')
    return remaining


@app.post('/api/retry')
def retry_workflow(body: dict):
    view = body.get('view')
    if view not in ('writer', 'agent', 'ingredients', 'omni', 'reverse'):
        raise HTTPException(400, 'Choose a workflow tab.')
    record = read_json(ROOT / 'logs' / 'desktop' / f'last_{view}_job.json')
    if not record:
        # Runs made before retry progress existed still have the original inputs.
        old = read_json(ROOT / 'logs' / 'desktop' / f"last_{'writer' if view == 'writer' else 'flow'}_request.json")
        if old.get('payload', {}).get('view') != view or old.get('action') not in RETRY_ACTIONS:
            raise HTTPException(400, 'No saved retry checkpoint for this tab yet. Start a run first.')
        try:
            lane, operations = plan_action(old['action'], old['payload'])
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        record = dict(**old, lane=lane, operations=operations, operation_index=0,
                      phase='saved driver checkpoint', status='stopped')
    try:
        operations = retry_plan(record)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    with lock:
        if any(j.status == 'running' and j.lane == record['lane'] for j in jobs.values()):
            raise HTTPException(409, 'Stop the current job first, then Retry / Continue.')
        job = Job(record['action'], record['payload'], record['lane'], operations)
        jobs[job.id] = job
        job.log(f"Retry / Continue: resuming {record.get('phase', 'failed step')} with the original inputs. Successful earlier operations are skipped; driver checkpoints preserve completed clips and downloads.")
        threading.Thread(target=job.run, daemon=True).start()
        return job.summary()
app.mount('/assets', StaticFiles(directory=UI), name='assets')


@app.middleware('http')
async def local_only(request: Request, call_next):
    host = request.headers.get('host', '').split(':')[0]
    if host not in ('127.0.0.1', 'localhost', 'testserver'):
        return JSONResponse({'detail': 'Local access only.'}, status_code=403)
    if request.url.path.startswith('/api/'):
        if not secrets.compare_digest(request.headers.get('x-session-token', ''), TOKEN):
            return JSONResponse({'detail': 'Invalid app session.'}, status_code=403)
        origin = request.headers.get('origin')
        if origin and origin != f'{request.url.scheme}://{request.headers.get("host")}':
            return JSONResponse({'detail': 'Foreign origin blocked.'}, status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'"
    return response


from video_editing_desktop import install as install_video_editing
install_video_editing(app, TOKEN, save_json)


@app.get('/', response_class=HTMLResponse)
def index():
    return UI.joinpath('index.html').read_text(encoding='utf-8').replace('__SESSION_TOKEN__', TOKEN)


@app.get('/api/bootstrap')
def bootstrap(studio_surface: str = Header(default='studio', alias='X-Studio-Surface')):
    legacy = read_json(ROOT / 'gui_settings.json')
    initial = dict(story=legacy.get('agent_story_json', ''), project=legacy.get('agent_project_url', ''),
                   cdp=legacy.get('agent_cdp_port', 9222), model=legacy.get('video_model', 'Omni 1.1 Flash'),
                   resolution=legacy.get('mcp_video_resolution', '360p'), aspect=legacy.get('aspect_ratio', '9:16'),
                   preset=legacy.get('gen_preset', 'relationship-dialogue'), clips=8, seconds=8,
                   transport=legacy.get('story_transport', 'web'), geminiModel=legacy.get('gemini_model', ''))
    workflow_defaults = {}
    for mode, prefix in [('agent', 'agent'), ('omni', 'omni'), ('ingredients', '')]:
        workflow_defaults[mode] = dict(story=legacy.get(f'{prefix}_story_json' if prefix else 'story_json', ''),
            project=legacy.get(f'{prefix}_project_url' if prefix else 'project_url', ''),
            cdp=legacy.get(f'{prefix}_cdp_port' if prefix else 'cdp_port', 9222))
    return dict(root=str(ROOT), models=MODELS, presets=presets(), defaults=initial, workflowDefaults=workflow_defaults,
                preferences=surface_preferences(studio_surface), hasApiKeys=bool(legacy.get('gemini_api_keys') or legacy.get('gemini_api_key')),
                referenceLibrary=reference_library_settings(legacy), globalWorkflow=global_workflow_settings(),
                savedCouple={k: legacy.get(k, '') for k in ('couple_sarah_file', 'couple_sam_file', 'couple_sarah_description', 'couple_sam_description', 'agent_saved_couple', 'ing_saved_couple', 'omni_saved_couple')})


def story_completion(path, story, manifest):
    """Classify local completed work without opening Flow or scanning the browser."""
    clips = path.parent / 'clips'
    downloaded = set()
    for item in manifest.get('clips', []):
        file = clips / str(item.get('file', ''))
        if item.get('got') is not False and file.suffix.lower() == '.mp4' and file.is_file() and file.stat().st_size > 0:
            downloaded.add(str(file.resolve()))
    total = len(story.get('scenes', []))
    complete_clips = total > 0 and len(downloaded) == total
    final = path.parent / 'clips_final.mp4'
    completed_final = final.is_file() and final.stat().st_size > 0 and final.stat().st_mtime >= path.stat().st_mtime
    return dict(downloaded=len(downloaded), done=bool(complete_clips or completed_final),
                completion='Final video saved' if completed_final else 'All clips downloaded' if complete_clips else 'Available')


@app.get('/api/reverse-runs')
def reverse_runs():
    from reverse_video_desktop import list_runs
    return list_runs(ROOT)


@app.get('/api/reverse-run')
def reverse_run(id: str):
    from reverse_video_desktop import read_run
    try:
        return read_run(ROOT, id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post('/api/reverse-save')
def reverse_save(body: dict):
    from reverse_video_desktop import register
    try:
        return register(ROOT, body)
    except (ValueError, OSError) as exc:
        raise HTTPException(400, str(exc))


@app.post('/api/ready-script/preflight')
def ready_script_preflight(payload: dict):
    try:
        _, operations = plan_action('import_script', payload)
        request = operations[0][1][1]
        result = subprocess.run(command('import_ready_script.js', '--inspect'), input=json.dumps(request),
            cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=90,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise ValueError(result.stderr.strip() or 'Import preflight failed.')
        reports = json.loads(result.stdout)
        return dict(reports=reports)
    except (ValueError, TypeError, OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(400, str(exc))


@app.get('/api/master-prompts')
def master_prompt_list():
    folder = ROOT / 'Master prompts'
    return [dict(**preset, available=(folder / (preset['id'] + '.txt')).is_file()) for preset in presets()]


@app.get('/api/master-prompt')
def master_prompt(preset: str):
    allowed = {p['id']: p for p in presets()}
    if preset not in allowed:
        raise HTTPException(400, 'Select a known preset.')
    folder = (ROOT / 'Master prompts').resolve()
    source = (folder / (preset + '.txt')).resolve()
    if source.parent != folder or not source.is_file():
        raise HTTPException(404, 'No saved master prompt is available for this preset.')
    return dict(id=preset, name=allowed[preset]['name'], text=source.read_text(encoding='utf-8-sig'))


@app.get('/api/library')
def library():
    result = []
    known=presets()
    ids={p['id'] for p in known}
    aliases={p['name'].strip().casefold():p['id'] for p in known}
    for path in (ROOT / 'stories').rglob('*_story.json'):
        if any(x in path.parts for x in ('backups', 'clips', 'logs')):
            continue
        story = read_json(path)
        if not story.get('scenes'):
            continue
        manifest = read_json(path.parent / 'clips' / 'manifest.json')
        result.append(dict(path=str(path), title=story.get('title', path.stem), scenes=len(story['scenes']),
                          duration=len(story['scenes']) * story.get('scene_seconds', 8),
                          preset=story.get('niche', ''), presetId=story.get('preset_id') if story.get('preset_id') in ids else aliases.get(str(story.get('niche','')).strip().casefold(),story.get('preset_id','')), modified=path.stat().st_mtime,
                          **story_completion(path, story, manifest)))
    return sorted(result, key=lambda x: x['modified'], reverse=True)


@app.get('/api/story')
def inspect_story(path: str):
    try:
        source, story = story_path(path)
        prompts = []
        for i, scene in enumerate(story['scenes'], 1):
            export = source.parent / 'clip_prompts' / f'clip_{i:03d}.txt'
            prompts.append(dict(number=i, title=scene.get('_scene_title', scene.get('title', f'Scene {i}')),
                                dialogue=scene.get('dialogue', []),
                                prompt=export.read_text(encoding='utf-8-sig') if export.is_file() else scene.get('veo3_prompt', '')))
        return dict(path=str(source), title=story.get('title', source.stem), scenes=len(prompts), prompts=prompts)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.get('/api/accounts')
def account_list():
    data = read_json(ROOT / 'accounts.json')
    return dict(current=data.get('current', 0), accounts=[{k: a.get(k) for k in ('label', 'email', 'max_clips', 'clips_used', 'clips_month', 'paused')} for a in data.get('accounts', [])])


def surface_preferences(surface):
    base = read_json(STATE)
    if surface != 'writer':
        return base
    saved = read_json(WRITER_STATE)
    saved.setdefault('theme', base.get('theme', 'crimson'))
    saved.setdefault('forms', {'writer': base.get('forms', {}).get('writer', {})})
    saved.setdefault('current', 'writer')
    return saved


@app.post('/api/preferences')
def preferences(data: dict, studio_surface: str = Header(default='studio', alias='X-Studio-Surface')):
    with lock:
        save_json(WRITER_STATE if studio_surface == 'writer' else STATE, data)
    return {'ok': True}


@app.post('/api/settings')
def settings(data: dict):
    with lock:
        if any(j.status == 'running' for j in jobs.values()):
            raise HTTPException(409, 'Finish or stop jobs before changing shared settings.')
        legacy = read_json(ROOT / 'gui_settings.json')
        if 'globalWorkflow' in data:
            try:legacy['workflow_globals']=global_workflow_settings(data['globalWorkflow'])
            except ValueError as exc:raise HTTPException(400,str(exc))
        allowed = {'couple_sarah_file', 'couple_sam_file', 'couple_sarah_description', 'couple_sam_description',
                   'agent_saved_couple', 'ing_saved_couple', 'omni_saved_couple', 'preset_reference_library', 'preset_reference_modes'}
        for key in allowed:
            if key in data:
                legacy[key] = data[key]
        if 'referenceFolders' in data:
            folders = data['referenceFolders']
            if not isinstance(folders, dict):
                raise HTTPException(400, 'Invalid preset reference folders.')
            legacy['preset_reference_library'] = {p['id']: {'folder': str(folders.get(p['id'], '')).strip() or str(ROOT / 'Preset References' / p['id'])} for p in presets()}
        if str(data.get('apiKeys', '')).strip():
            legacy['gemini_api_keys'] = [x.strip() for x in data['apiKeys'].splitlines() if x.strip()]
        save_json(ROOT / 'gui_settings.json', legacy)
    return {'ok': True}


@app.post('/api/jobs')
def start_job(body: dict):
    action, payload = str(body.get('action', '')), body.get('payload', {})
    if not isinstance(payload, dict):
        raise HTTPException(400, 'Invalid job inputs.')
    try:
        payload=global_workflow_payload(payload)
        lane, operations = plan_action(action, payload)
    except (ValueError, TypeError, OSError) as exc:
        raise HTTPException(400, str(exc))
    with lock:
        if any(j.status == 'running' and j.lane == lane for j in jobs.values()):
            raise HTTPException(409, f'A {lane} job is running. Stop it or wait for completion.')
        if action == 'account_use' and any(j.status == 'running' and j.lane == 'writer' for j in jobs.values()):
            # The legacy browser switch matches the flow-profiles prefix, which
            # also matches AI Studio's profile. Do not close a writing session.
            raise HTTPException(409, 'Finish or stop writing before switching the account browser.')
        if len(jobs) >= 100:
            oldest = next((key for key, value in jobs.items() if value.status != 'running'), None)
            if oldest:
                del jobs[oldest]
        job = Job(action, payload, lane, operations)
        jobs[job.id] = job
        save_json(ROOT / 'logs' / 'desktop' / f'last_{lane}_request.json', dict(action=action, payload=payload))
        threading.Thread(target=job.run, daemon=True).start()
        return job.summary()


@app.get('/api/jobs')
def list_jobs():
    with lock:
        return [j.summary() for j in reversed(list(jobs.values()))]


@app.get('/api/jobs/{job_id}')
def job_status(job_id: str, after: int = 0):
    with lock:
        if job_id not in jobs:
            raise HTTPException(404, 'Job not found.')
        job = jobs[job_id]
        return dict(**job.summary(), logs=[x for x in job.logs if x['id'] > after], cursor=job.sequence)


@app.post('/api/jobs/{job_id}/stop')
def stop_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, 'Job not found.')
    jobs[job_id].stop()
    return {'ok': True}


@app.get('/api/jobs/{job_id}/log')
def full_job_log(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, 'Job not found.')
    path = ROOT / 'logs' / 'desktop' / (job_id + '.log')
    return {'text': path.read_text(encoding='utf-8') if path.is_file() else ''}


class DesktopBridge:
    def __init__(self, base_url=None):
        self._base_url = base_url
        self._window = None
        self._writer_window = None

    def choose_file(self, kind='story'):
        import webview
        if kind == 'folder':
            result = (self._window or webview.windows[0]).create_file_dialog(webview.FileDialog.FOLDER, directory=str(ROOT / 'Preset References'))
            return str(result[0]) if result else ''
        types = ('Videos (*.mp4;*.mov;*.m4v;*.webm;*.mkv;*.avi)',) if kind == 'video' else ('Images (*.png;*.jpg;*.jpeg;*.webp)',) if kind == 'image' else ('JSON files (*.json)',)
        result = (self._window or webview.windows[0]).create_file_dialog(webview.FileDialog.OPEN, directory=str(ROOT / 'stories'), file_types=types)
        return str(result[0]) if result else ''

    def open_story_folder(self, path):
        source, _ = story_path(path)
        os.startfile(str(source.parent))
        return True

    def open_legacy(self):
        subprocess.Popen([sys.executable, str(ROOT / 'veo3_gui.py')], cwd=ROOT,
                         creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return True

    def open_story_writer(self):
        """A dedicated window shares the server's separate writer/Flow job lanes."""
        import webview
        if not self._base_url:
            raise RuntimeError('The Studio server URL is not available.')
        if self._writer_window is not None:
            self._writer_window.show()
            self._writer_window.restore()
            return True
        bridge = DesktopBridge(self._base_url)
        theme = surface_preferences('writer').get('theme', 'crimson')
        background = {'crimson': '#09090b', 'ember': '#0b0806', 'matte': '#e6e7eb', 'lime': '#0f1113'}.get(theme, '#09090b')
        window = webview.create_window('VEO3 Story Writer', self._base_url + '/?writer=1', js_api=bridge,
            width=1120, height=850, min_size=(980, 620), background_color=background, confirm_close=True)
        bridge._window = window
        self._writer_window = window
        window.events.closed += lambda: setattr(self, '_writer_window', None)
        return True


def main():
    import uvicorn
    import webview
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level='warning', access_log=False))
    thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(.05)
    if not server.started:
        raise RuntimeError('The local app server did not start.')
    screen = webview.screens[0]
    width, height = min(1380, screen.width - 40), min(920, screen.height - 80)
    theme = read_json(STATE).get('theme', 'crimson')
    background = {'crimson': '#09090b', 'ember': '#0b0806', 'matte': '#e6e7eb', 'lime': '#0f1113'}.get(theme, '#09090b')
    bridge = DesktopBridge(f'http://127.0.0.1:{port}')
    bridge._window = webview.create_window('VEO3 Studio', bridge._base_url, js_api=bridge,
                          width=width, height=height, min_size=(980, 620), background_color=background, confirm_close=True)
    try:
        webview.start(gui='edgechromium')
    finally:
        for job in list(jobs.values()):
            if job.status == 'running':
                job.stop()
        server.should_exit = True


if __name__ == '__main__':
    main()
