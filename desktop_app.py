"""Local desktop shell for the existing drivers. No generation engine lives here."""
from pathlib import Path
from collections import deque
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from mcp_client import MCPClient

ROOT = Path(__file__).resolve().parent
UI = ROOT / 'desktop_ui'
STATE = ROOT / 'desktop_settings.json'
TOKEN = secrets.token_urlsafe(32)
MODELS = ['Flow', 'Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality', 'Veo 3.1 - Lite [Lower Priority]']
lock = threading.RLock()


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return {} if default is None else default


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    temp.replace(path)


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


def presets():
    result = []
    for filename, group in [('styles.json', 'Classic'), ('genai_styles.json', 'GENAI')]:
        data = read_json(ROOT / filename)
        for p in data.get('styles', data.get('presets', [])):
            if p.get('id'):
                result.append(dict(id=p['id'], name=p.get('name', p.get('label', p['id'])), group=group))
    return result


def active_account():
    data = read_json(ROOT / 'accounts.json')
    accounts = data.get('accounts', [])
    index = data.get('current', 0)
    return accounts[index].get('label', '') if accounts and 0 <= index < len(accounts) else ''


def command(filename, *args):
    return ['node', str(ROOT / filename), *map(str, args)]


def plan_action(action, p):
    """Validate UI input and create allowlisted operations, never arbitrary commands."""
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
            blocks = re.split(r'(?im)^\s*STORY\s+\d+\s*[:.-]?\s*$', str(p.get('ideas', '')))
            ideas = []
            for block in blocks:
                lines = block.strip().splitlines()
                if not lines:
                    continue
                title = re.sub(r'(?i)^title\s*:\s*', '', lines[0]).strip()
                ideas.append(dict(title=title, detail='\n'.join(lines[1:]).strip(), preset=preset, duration=clips * seconds))
            if not ideas:
                raise ValueError('Add a title and story details.')
            args['ideas'] = ideas
            args['match_ref'] = False
        if args['aspect'] not in ('Flow', '9:16', '16:9', '1:1'):
            raise ValueError('Invalid aspect ratio.')
        return 'writer', [('mcp', ('batch_pipeline', args))]
    if action.startswith('account_'):
        operation = action.removeprefix('account_')
        if operation not in ('add', 'use', 'pause', 'resume', 'reset', 'remove'):
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
    if resolution not in ('Flow', '360p', '720p'):
        raise ValueError('Invalid resolution.')
    seconds = integer(p.get('seconds', story.get('scene_seconds', 8)), 1, 15, 'Clip duration')
    total = len(story['scenes'])
    first = integer(p.get('from', 1), 1, total, 'First scene')
    last = integer(p.get('to', total) or total, first, total, 'Last scene')
    project = project_url(p.get('project'), required=action in ('manual', 'retry_failed', 'delete', 'download'))
    base = ['--cdp', str(port)]
    if project:
        base += ['--project-url', project]
    if action == 'build':
        return 'flow', [('cli', command('story_to_agent_prompt.js', path, '--aspect', aspect, '--seconds', seconds))]
    if action in ('join', 'order', 'export_excel'):
        if action == 'export_excel':
            return 'flow', [('cli', [sys.executable, str(ROOT / 'story_to_excel.py'), str(path)])]
        if action == 'order':
            return 'flow', [('cli', command('order_clips_by_dialogue.js', path, '--clips', path.parent / 'clips', '--write'))]
        return 'flow', [('cli', command('join_clips.js', path.parent / 'clips'))]
    if action == 'delete':
        if not p.get('confirmed'):
            raise ValueError('Confirm moving all project videos to Trash first.')
        return 'flow', [('request', ('delete_project_video_clips.js', dict(project=project, story=str(path), cdp=port, confirmed=True)))]
    if action == 'retry_failed':
        return 'flow', [('cli', command('agent_mode.js', '--retry-failed-only', '--expected', total,
                                       '--retry-rounds', 8, '--retry-watch', 90, *base))]
    if action == 'manual':
        selection = str(p.get('selection', '')).strip()
        batch = p.get('selectionType') == 'batch'
        if batch:
            integer(selection, 1, (total + 4) // 5, 'Batch number')
        else:
            for part in re.split(r'[\s,]+', selection):
                if not re.fullmatch(r'\d+(?:-\d+)?', part):
                    raise ValueError('Use clip numbers such as 2,8,6 or 3-5.')
                ends = list(map(int, part.split('-')))
                integer(ends[0], 1, total, 'Clip number')
                integer(ends[-1], ends[0], total, 'Clip number')
        return 'flow', [('cli', command('agent_manual_generation.js', '--story', path,
                '--batch' if batch else '--clips', selection, '--watch', 1800,
                '--aspect', aspect, '--video-model', model, '--video-resolution', resolution,
                '--scene-seconds', seconds, *base))]
    if view == 'omni':
        if seconds != 8:
            raise ValueError('The current Single Clip Omni driver uses 8-second clips.')
        if not re.search(r'Omni.*Flash', model, re.I):
            raise ValueError('Single Clip Omni requires Omni Flash.')
        req = dict(story=str(path), project=project, cdp=port, model=model, aspect=aspect,
                   resolution=resolution, **{'from': first, 'to': last},
                   newProject=bool(p.get('newProject')), reuseRefs=bool(p.get('reuseRefs')),
                   genRefs=bool(p.get('genRefs')) and not p.get('reuseRefs'),
                   savedCouple=bool(p.get('savedCouple', read_json(ROOT / 'gui_settings.json').get('omni_saved_couple', False))), simple=bool(p.get('simple', True)),
                   refsOnly=action == 'refs', download=bool(p.get('download', True)), join=bool(p.get('join')))
        if active_account():
            req['account'] = active_account()
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
        if 'omni' in model.lower() or resolution == '360p':
            cmd.append('--upscaled')
        return 'flow', [('cli', cmd)]
    if view == 'ingredients':
        cmd = command('veo3_flow_new_ui.js', path, '--from', first, '--to', last,
                      '--video-model', model, '--aspect', aspect, *base)
        if active_account():
            cmd += ['--account', active_account()]
        resume = first > 1 and action != 'refs'
        if resume and not project:
            raise ValueError('Resuming Ingredients requires the existing project URL.')
        for condition, flag in [(action == 'refs', '--refs-only'),
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
    if not p.get('newProject'):
        # Use the same explicit-project CLI as the classic Agent tab. The full
        # pipeline's start phase discovers its project instead of taking this URL.
        operations = [('cli', command('story_to_agent_prompt.js', path, '--aspect', aspect, '--seconds', seconds))]
        if p.get('genRefs') and not p.get('reuseRefs'):
            operations.append(('cli', command('generate_refs.js', '--story', path, *base)))
        driver = command('agent_batch_run.js', '--file', path.parent / 'agent_prompt.txt', '--refs', path,
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
                project_url=project, generate=True, submit=True, auto_approve=True,
                video_model=model, video_resolution=resolution, aspect=aspect, seconds=seconds,
                cdp=port, watch=1800, new_project=bool(p.get('newProject')),
                generate_refs=bool(p.get('genRefs')), no_upload_refs=bool(p.get('reuseRefs')),
                download=bool(p.get('download', True) or p.get('join')), join=bool(p.get('join')))
    return 'flow', [('mcp', ('batch_pipeline', args))]


class Job:
    def __init__(self, action, payload, lane, operations):
        self.id = uuid.uuid4().hex
        self.action, self.payload, self.lane, self.operations = action, payload, lane, operations
        self.status = 'running'
        self.created = time.time()
        self.finished = None
        self.proc = None
        self.client = None
        self.stopped = False
        self.logs = deque(maxlen=4000)
        self.sequence = 0

    def log(self, line):
        # Driver output may contain keys. Never display complete tokens in the UI.
        line = re.sub(r'AIza[\w-]{35}', '[API key hidden]', str(line))
        for key in read_json(ROOT / 'gui_settings.json').get('gemini_api_keys', []):
            if isinstance(key, str) and len(key) > 10:
                line = line.replace(key, '[API key hidden]')
        with lock:
            self.sequence += 1
            self.logs.append(dict(id=self.sequence, text=line, time=time.time()))
            folder = ROOT / 'logs' / 'desktop'
            folder.mkdir(parents=True, exist_ok=True)
            with (folder / (self.id + '.log')).open('a', encoding='utf-8') as stream:
                stream.write(line + '\n')

    def summary(self):
        return dict(id=self.id, action=self.action, lane=self.lane, status=self.status,
                    created=self.created, finished=self.finished, latest=self.logs[-1]['text'] if self.logs else '')

    def stop(self):
        with lock:
            self.stopped = True
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

    def run(self):
        try:
            for kind, spec in self.operations:
                if self.stopped:
                    break
                if kind == 'request':
                    filename, request = spec
                    requestfile = ROOT / 'logs' / 'desktop' / (self.id + '.json')
                    save_json(requestfile, request)
                    kind, spec = 'cli', command(filename, requestfile)
                if kind == 'cli':
                    self.log('Starting ' + Path(spec[1]).name)
                    with lock:
                        if self.stopped:
                            break
                        self.proc = subprocess.Popen(spec, cwd=ROOT, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace',
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
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
                        self.client = MCPClient(str(ROOT / 'mcp_server.js'), cwd=str(ROOT), log=self.log)
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
            self.status = 'stopped' if self.stopped else 'completed'
        except Exception as exc:
            self.log(str(exc))
            self.status = 'stopped' if self.stopped else 'failed'
        finally:
            if self.client:
                self.client.stop()
            self.finished = time.time()
            save_json(ROOT / 'logs' / 'desktop' / (self.id + '.result.json'), self.summary())


jobs = {}
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
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
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
    return response


@app.get('/', response_class=HTMLResponse)
def index():
    return UI.joinpath('index.html').read_text(encoding='utf-8').replace('__SESSION_TOKEN__', TOKEN)


@app.get('/api/bootstrap')
def bootstrap():
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
                preferences=read_json(STATE), hasApiKeys=bool(legacy.get('gemini_api_keys') or legacy.get('gemini_api_key')),
                savedCouple={k: legacy.get(k, '') for k in ('couple_sarah_file', 'couple_george_file', 'couple_sarah_description', 'couple_george_description', 'agent_saved_couple', 'ing_saved_couple', 'omni_saved_couple')})


@app.get('/api/library')
def library():
    result = []
    for path in (ROOT / 'stories').rglob('*_story.json'):
        if any(x in path.parts for x in ('backups', 'clips', 'logs')):
            continue
        story = read_json(path)
        if not story.get('scenes'):
            continue
        manifest = read_json(path.parent / 'clips' / 'manifest.json')
        result.append(dict(path=str(path), title=story.get('title', path.stem), scenes=len(story['scenes']),
                          duration=len(story['scenes']) * story.get('scene_seconds', 8),
                          preset=story.get('niche', ''), modified=path.stat().st_mtime,
                          downloaded=sum(1 for x in manifest.get('clips', []) if x.get('got') is not False and (path.parent / 'clips' / x.get('file', '')).is_file())))
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


@app.post('/api/preferences')
def preferences(data: dict):
    with lock:
        save_json(STATE, data)
    return {'ok': True}


@app.post('/api/settings')
def settings(data: dict):
    with lock:
        if any(j.status == 'running' for j in jobs.values()):
            raise HTTPException(409, 'Finish or stop jobs before changing shared settings.')
        legacy = read_json(ROOT / 'gui_settings.json')
        allowed = {'couple_sarah_file', 'couple_george_file', 'couple_sarah_description', 'couple_george_description',
                   'agent_saved_couple', 'ing_saved_couple', 'omni_saved_couple'}
        for key in allowed:
            if key in data:
                legacy[key] = data[key]
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
    def choose_file(self, kind='story'):
        import webview
        types = ('Images (*.png;*.jpg;*.jpeg;*.webp)',) if kind == 'image' else ('JSON files (*.json)',)
        result = webview.windows[0].create_file_dialog(webview.FileDialog.OPEN, directory=str(ROOT / 'stories'), file_types=types)
        return str(result[0]) if result else ''

    def open_story_folder(self, path):
        source, _ = story_path(path)
        os.startfile(str(source.parent))
        return True

    def open_legacy(self):
        subprocess.Popen([sys.executable, str(ROOT / 'veo3_gui.py')], cwd=ROOT,
                         creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
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
    background = {'crimson': '#09090b', 'ember': '#0b0806', 'matte': '#e6e7eb'}.get(theme, '#09090b')
    webview.create_window('VEO3 Studio', f'http://127.0.0.1:{port}', js_api=DesktopBridge(),
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
