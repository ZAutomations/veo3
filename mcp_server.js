#!/usr/bin/env node
/**
 * VEO3 FLOW - MCP SERVER (stdio)
 * ==============================
 * Exposes the whole pipeline to any MCP client (Claude Desktop, Cursor, Cline,
 * Windsurf, opencode...) as tools, so an agent can write a story, build the
 * agent prompt, drive Flow, download the clips and join them - without a human
 * retyping commands into the GUI.
 *
 *   write_story.js            -> tool "write_story"
 *   story_to_agent_prompt.js  -> tool "build_prompt"
 *   agent_mode.js             -> tool "run_agent"
 *   agent_download.js         -> tool "download_clips"
 *   join_clips.js             -> tool "join_clips"
 *   (all five chained)        -> tool "full_pipeline"
 *
 * TRANSPORT: MCP over stdio, dependency-free. Every message is one line of
 * JSON-RPC 2.0 on stdout; every log goes to stderr, because stdout is reserved
 * for the protocol. There is no network listener and no npm dependency - the
 * same reason write_story.js has almost none.
 *
 * Configure a client with:
 *   {
 *     "mcpServers": {
 *       "veo3-flow": { "command": "node", "args": ["D:/MyFinalAutomations/Veo3/mcp_server.js"] }
 *     }
 *   }
 *
 * API keys are NOT passed here: write_story.js reads them from `--key`,
 * GEMINI_API_KEY, or the `gemini_api_keys` array in gui_settings.json (the
 * GUI's Script tab). A `keys` argument is still accepted and forwarded.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HERE = __dirname;
const STORIES_DIR = path.join(HERE, 'stories');
const STYLES_FILE = path.join(HERE, 'styles.json');
const GENAI_STYLES_FILE = path.join(HERE, 'genai_styles.json');

const SERVER_NAME = 'veo3-flow';
const SERVER_VERSION = '1.0.0';
const DEFAULT_PROTOCOL = '2025-06-18';

function log(...a) { process.stderr.write('[mcp] ' + a.join(' ') + '\n'); }

// ── generic child runner -----------------------------------------------------
// One place for the "run a stage script and capture it" dance. Output is
// captured, never inherited: a stage printing to our stdout would corrupt the
// JSON-RPC stream.
function runNode(script, args, opts = {}) {
    const timeoutMs = opts.timeoutMs || 0;
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(HERE, script), ...args], {
            cwd: HERE, env: process.env, windowsHide: true,
        });
        let out = '', err = '', timer = null, killed = false;
        if (timeoutMs > 0) {
            timer = setTimeout(() => { killed = true; try { child.kill(); } catch (e) { /* gone */ } }, timeoutMs);
        }
        child.stdout.on('data', (d) => { out += d.toString('utf8'); });
        child.stderr.on('data', (d) => { err += d.toString('utf8'); });
        child.on('error', (e) => {
            if (timer) clearTimeout(timer);
            resolve({ code: -1, out, err: err + '\n' + e.message, killed });
        });
        child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            resolve({ code, out, err, killed });
        });
    });
}

// ── small helpers ------------------------------------------------------------
const REFERENCE_DIR = path.join(STORIES_DIR, '_reference');

function slugifyTitle(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '').slice(0, 60) || 'untitled';
}
// The story package already on disk for a title, if any.
function storyExists(title) {
    if (!title) return null;
    const slug = slugifyTitle(title);
    const p = path.join(STORIES_DIR, slug, `${slug}_story.json`);
    return fs.existsSync(p) ? p : null;
}
// A reference link -> the story already made from it, matched through the
// source_url analyze_video records in the content map.
// The PARSED content map for a reference URL, or null. storyForReference reads
// the same files to find the story; the reuse check needs the map itself, to
// work out what length this run is asking for before deciding to reuse.
function contentMapForReference(url) {
    try {
        for (const f of fs.readdirSync(REFERENCE_DIR)) {
            if (!f.endsWith('.content-map.json')) continue;
            const cm = readJson(path.join(REFERENCE_DIR, f), null);
            if (cm && cm.source_url === url) return cm;
        }
    } catch (e) { /* no reference folder yet */ }
    return null;
}

function storyForReference(url) {
    const cm = contentMapForReference(url);
    return cm ? storyExists(cm.title_suggestion) : null;
}

function readJson(p, def) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; }
}
function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '').slice(0, 60) || 'untitled';
}
function tmpFile(prefix, content) {
    const p = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(p, content, 'utf8');
    return p;
}
function pushOpt(args, flag, val) {
    if (val !== undefined && val !== null && val !== '' && val !== false) args.push(flag, String(val));
}
// A story may be given as the JSON path, or as its folder.
function resolveStoryJson(p) {
    if (!p) return null;
    const abs = path.resolve(HERE, String(p));
    try {
        const st = fs.statSync(abs);
        if (st.isFile() && abs.toLowerCase().endsWith('.json')) return abs;
        if (st.isDirectory()) {
            const f = fs.readdirSync(abs).find((x) => x.toLowerCase().endsWith('_story.json'));
            return f ? path.join(abs, f) : null;
        }
    } catch (e) { /* does not exist */ }
    return null;
}
function storyDirOf(storyJson) { return path.dirname(storyJson); }
function text(s) { return { content: [{ type: 'text', text: String(s) }] }; }
function fail(s) { return { content: [{ type: 'text', text: String(s) }], isError: true }; }

// The last useful words of a stage's output, for a failure line. Prefers the
// engine's own "FAILED: ..." message (a 503, a validation list), else the tail.
function tailOf(s, n = 240) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '(no output)';
    const m = t.match(/FAILED:.{0,200}/);
    return (m ? m[0] : t.slice(-n)).slice(0, n);
}

// A model or a chain. Accepts "a,b" or ["a","b"]; both become "a,b" for --model.
// The scripts walk the chain themselves, so order is newest-first.
function modelArg(a) {
    if (a && a.models) return [].concat(a.models).map((m) => String(m).trim()).filter(Boolean).join(',');
    return String((a && a.model) || '').trim();
}

// ── stages -------------------------------------------------------------------
// Each returns { ok, text, storyJson?, data? }. Throwing is reserved for a
// broken call; a stage that runs and fails returns ok:false with the output.

// How long the reference video actually is, from the content map's segment
// timestamps. The clip count is then that length divided by the clip seconds,
// so a 101s reference at 8s/clip asks for 13 clips instead of compressing (and
// losing) the story into a fixed 9. Rounded UP to a whole number of clips.
function refDuration(cm, seconds) {
    // `cm` arrives as the content map's FILE PATH from doAnalyzeVideo, not as a
    // parsed object - a string here is the normal case, not a caller error. The
    // lookups below used to find no clips and no format on a string, so this
    // returned undefined, storyDuration fell through to clips x seconds, and
    // "Match the video link's own length" silently did nothing: a 146s reference
    // was written as 8 scenes because the clips box happened to say 8.
    if (typeof cm === 'string') {
        try { cm = JSON.parse(fs.readFileSync(cm, 'utf8')); } catch (e) { return undefined; }
    }
    const clips = (cm && (cm.clips || cm.segments)) || [];
    const facts = (cm && Array.isArray(cm.facts)) ? cm.facts : [];
    const fmt = (cm && cm.format) || {};
    const toSec = (t) => {
        const m = String(t || '').match(/^(\d+):(\d+)$/);
        return m ? (+m[1]) * 60 + (+m[2]) : 0;
    };
    let max = 0;
    for (const c of clips) max = Math.max(max, toSec(c.t_end), toSec(c.t_start));
    // A fast reference often ships facts without per-clip timestamps, so the
    // fact times and the analyser's own length reading are valid fallbacks.
    for (const f of facts) max = Math.max(max, toSec(f.t));
    const declared = Number(cm && cm.source_duration_s) || Number(fmt.source_duration_s) ||
        Number(cm && cm.total_seconds) || 0;
    if (declared > max) max = declared;
    if (!max) return undefined;
    const per = Number(seconds) > 0 ? Number(seconds) : 8;
    return Math.max(per, Math.ceil(max / per) * per);
}

// Which total duration a film should be built to.
//   match_ref (default ON): a paste-a-link film is built to the REFERENCE's own
//     length, so a 2-minute source asks for 15 clips - the predefined clip count
//     is ignored. Falls back when there is no reference (an idea/title).
//   match_ref OFF: the caller's own numbers win - item duration, then the batch
//     duration, then clips x seconds.
function storyDuration(a, contentMap, item) {
    const sec = Number(a.seconds) > 0 ? Number(a.seconds) : 8;
    const matchRef = a.match_ref !== false;
    if (matchRef) {
        const rd = refDuration(contentMap, sec);
        if (rd) return rd;
    }
    if (item && Number(item.duration) > 0) return Number(item.duration);
    if (Number(a.duration) > 0) return Number(a.duration);
    if (Number(a.clips) > 0) return Number(a.clips) * sec;
    return refDuration(contentMap, sec);
}

// The Flow voice asset(s) a preset asks for: one narrator, or one per
// character for a two-hander. Optional; empty means "let Veo choose".
function presetVoices(id) {
    if (!id) return [];
    for (const f of ['styles.json', 'genai_styles.json']) {
        try {
            const db = JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
            const p = (db.styles || []).find((x) => x.id === id || x.label === id);
            if (p) {
                if (Array.isArray(p.flow_voices)) return p.flow_voices.map(String).filter(Boolean);
                if (p.flow_voice) return [String(p.flow_voice)];
                return [];
            }
        } catch (e) { /* a missing optional list is fine */ }
    }
    return [];
}

async function doAnalyzeVideo(a) {
    const url = String(a.url || '').trim();
    if (!url) return { ok: false, text: 'url is required.', contentMap: null, detailFile: null };
    const args = [url];
    pushOpt(args, '--preset', a.preset);
    pushOpt(args, '--seconds', a.seconds);
    pushOpt(args, '--clips', a.clips);
    pushOpt(args, '--model', modelArg(a));
    pushOpt(args, '--out', a.out);
    for (const k of (a.keys || [])) args.push('--key', String(k));
    const r = await runNode('analyze_video.js', args, { timeoutMs: 15 * 60 * 1000 });
    const mapM = r.out.match(/content_map\s*:\s*(.+)/);
    const detM = r.out.match(/\bdetail\s*:\s*(.+)/);
    return {
        ok: r.code === 0,
        text: r.out + (r.err ? '\n[stderr]\n' + r.err : ''),
        contentMap: mapM ? mapM[1].trim() : null,
        detailFile: detM ? detM[1].trim() : null,
    };
}

async function doGenerateRefs(a) {
    const sJson = resolveStoryJson(a.story);
    const target = String(sJson ? storyDirOf(sJson) : (a.story || '')).trim();
    if (!target) return { ok: false, text: 'Give a story (folder or JSON) whose refs.json exists.' };
    const args = ['--story', path.resolve(HERE, target)];
    pushOpt(args, '--only', a.only);
    pushOpt(args, '--cdp', a.cdp);
    pushOpt(args, '--wait', a.wait);
    if (a.aspect && !/^(flow|auto|default|none)$/i.test(String(a.aspect))) pushOpt(args, '--ratio', a.aspect);
    // The film's video model, saved into the project here so the agent step finds
    // it already right. Same "Flow" sentinel as the aspect.
    if (a.video_model && !/^(flow|auto|default|none)$/i.test(String(a.video_model))) {
        pushOpt(args, '--video-model', a.video_model);
    }
    if (a.dry) args.push('--dry');
    const perImage = Number(a.wait) > 0 ? Number(a.wait) : 180;
    const r = await runNode('generate_refs.js', args, { timeoutMs: perImage * 1000 * 8 + 120000 });
    return { ok: r.code === 0, text: r.out + (r.err ? '\n[stderr]\n' + r.err : '') };
}

async function doNewProject(a) {
    const args = [];
    pushOpt(args, '--cdp', a.cdp);
    pushOpt(args, '--timeout', a.timeout);
    if (a.probe) args.push('--probe');
    if (a.no_create) args.push('--no-create');
    if (a.instructions) args.push('--instructions', path.resolve(HERE, String(a.instructions)));
    const r = await runNode('project_setup.js', args, { timeoutMs: 5 * 60 * 1000 });
    const urlM = r.out.match(/project_url\s*:\s*(\S+)/);
    const idM = r.out.match(/project_id\s*:\s*(\S+)/);
    return {
        ok: r.code === 0,
        text: r.out + (r.err ? '\n[stderr]\n' + r.err : ''),
        projectUrl: urlM ? urlM[1].trim() : null,
        projectId: idM ? idM[1].trim() : null,
    };
}

async function doWriteStory(a) {
    const title = String(a.title || '').trim();
    const preset = String(a.preset || '').trim();
    if (!title && !a.content_map) return { ok: false, text: 'title is required (or pass a content_map that carries a title_suggestion).' };
    if (!preset && !a.content_map) return { ok: false, text: 'preset is required (see list_presets).' };

    const args = [];
    if (title) args.push('--title', title);
    if (preset) args.push('--preset', preset);
    let detailFile = null;
    if (a.detail) { detailFile = tmpFile('mcp_detail', String(a.detail)); args.push('--detail-file', detailFile); }
    if (a.content_map) args.push('--content-map', path.resolve(HERE, String(a.content_map)));
    pushOpt(args, '--duration', a.duration);
    pushOpt(args, '--seconds', a.scene_seconds);
    pushOpt(args, '--aspect', a.aspect);
    pushOpt(args, '--model', modelArg(a));
    pushOpt(args, '--out', a.out);
    pushOpt(args, '--cast', a.cast);
    if (a.no_house_cast) args.push('--no-house-cast');
    if (a.force) args.push('--force');
    if (a.dry_run) args.push('--dry-run');
    for (const k of (a.keys || [])) args.push('--key', String(k));

    try {
        const r = await runNode('write_story.js', args, { timeoutMs: 20 * 60 * 1000 });
        const m = r.out.match(/wrote\s+(.+_story\.json)/i);
        const storyJson = m ? path.resolve(HERE, m[1].trim()) : null;
        const ok = r.code === 0 && !!storyJson;
        return {
            ok,
            storyJson,
            text: r.out + (r.err ? '\n[stderr]\n' + r.err : '') +
                (ok ? '' : '\n\nwrite_story did not report a story JSON - see the output above.'),
        };
    } finally {
        if (detailFile) { try { fs.unlinkSync(detailFile); } catch (e) { /* best effort */ } }
    }
}

async function doBuildPrompt(a) {
    const storyJson = resolveStoryJson(a.story);
    if (!storyJson) return { ok: false, text: `No story JSON found at "${a.story}".` };
    const args = [storyJson];
    pushOpt(args, '--aspect', a.aspect);
    pushOpt(args, '--seconds', a.scene_seconds);
    const r = await runNode('story_to_agent_prompt.js', args, { timeoutMs: 2 * 60 * 1000 });
    const promptFile = path.join(storyDirOf(storyJson), 'agent_prompt.txt');
    return {
        ok: r.code === 0,
        storyJson,
        text: r.out + (r.err ? '\n[stderr]\n' + r.err : '') +
            `\n\nagent_prompt.txt: ${fs.existsSync(promptFile) ? promptFile : '(not written)'}`,
    };
}

async function doRunAgent(a) {
    const storyJson = resolveStoryJson(a.story);
    if (!storyJson) return { ok: false, text: `No story JSON found at "${a.story}".` };
    const promptFile = path.join(storyDirOf(storyJson), 'agent_prompt.txt');
    if (!fs.existsSync(promptFile)) {
        return { ok: false, text: `agent_prompt.txt is missing in ${storyDirOf(storyJson)}. Run build_prompt first.` };
    }
    const args = ['--file', promptFile, '--refs', storyJson, '--cdp', String(a.cdp || 9222)];
    pushOpt(args, '--project-url', a.project_url);
    pushOpt(args, '--watch', a.watch);
    pushOpt(args, '--model', a.model);
    // "Flow" is the sentinel for "leave the project alone" - passing it as a
    // model name would look for a model called Flow and fail the run.
    if (a.video_model && !/^(flow|auto|default|none)$/i.test(String(a.video_model))) {
        pushOpt(args, '--video-model', a.video_model);
    }
    for (const v of (a.voices || [])) args.push('--voice', String(v));
    // SPENDING CREDITS IS OPT-IN. Without submit:true this is a dry run that
    // types the prompt and stops, exactly like the GUI's no-submit default.
    if (a.submit) {
        if (a.auto_approve !== false) args.push('--auto-approve');
    } else {
        args.push('--no-submit');
    }
    if (a.no_upload_refs) args.push('--no-upload-refs');
    if (a.paste) args.push('--paste');
    const watch = Number(a.watch) > 0 ? Number(a.watch) : 240;
    // Budget includes the bounded retry pass (3 rounds ~75s each by default).
    const r = await runNode('agent_mode.js', args, { timeoutMs: (watch + 480) * 1000 });
    return {
        ok: r.code === 0,
        storyJson,
        text: (a.submit ? '' : 'DRY RUN (no credits spent - pass submit:true to generate).\n\n') +
            r.out + (r.err ? '\n[stderr]\n' + r.err : '') +
            (r.killed ? '\n\nNOTE: the run hit the MCP timeout and was stopped.' : ''),
    };
}

async function doDownloadClips(a) {
    const storyJson = resolveStoryJson(a.story);
    let out = a.out;
    if (!out && storyJson) out = path.join(storyDirOf(storyJson), 'clips');
    if (!out) return { ok: false, text: 'Give either story (folder or JSON) or an explicit out folder.' };
    const args = ['--out', path.resolve(HERE, String(out)), '--cdp', String(a.cdp || 9222)];
    if (a.reverse !== false) args.push('--reverse');
    pushOpt(args, '--method', a.method);
    pushOpt(args, '--limit', a.limit);
    if (a.probe) args.push('--probe');
    if (a.no_sheet) args.push('--no-sheet');
    const r = await runNode('agent_download.js', args, { timeoutMs: 20 * 60 * 1000 });
    return { ok: r.code === 0, storyJson, text: r.out + (r.err ? '\n[stderr]\n' + r.err : '') };
}

async function doJoin(a) {
    const clipsDir = a.clips_dir || (() => {
        const s = resolveStoryJson(a.story);
        return s ? path.join(storyDirOf(s), 'clips') : null;
    })();
    if (!clipsDir) return { ok: false, text: 'Give clips_dir, or a story whose clips/ folder exists.' };
    const abs = path.resolve(HERE, String(clipsDir));
    if (!fs.existsSync(abs)) return { ok: false, text: `Clips folder not found: ${abs}` };
    const args = [abs];
    pushOpt(args, '--out', a.out);
    pushOpt(args, '--order', a.order);
    if (a.reverse) args.push('--reverse');
    if (a.reencode) args.push('--reencode');
    if (a.copy) args.push('--copy');
    if (a.dry_run) args.push('--dry-run');
    const r = await runNode('join_clips.js', args, { timeoutMs: 30 * 60 * 1000 });
    return { ok: r.code === 0, text: r.out + (r.err ? '\n[stderr]\n' + r.err : '') };
}

function statusOf(storyJson) {
    const dir = storyDirOf(storyJson);
    const clipsDir = path.join(dir, 'clips');
    const clips = fs.existsSync(clipsDir)
        ? fs.readdirSync(clipsDir).filter((f) => /^scene-\d+\.mp4$/i.test(f)).length : 0;
    const finalFiles = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => /_final\.mp4$/i.test(f)) : [];
    const story = readJson(storyJson, {});
    return {
        story_json: storyJson,
        title: story.title || null,
        scenes: Array.isArray(story.scenes) ? story.scenes.length : null,
        narration_scope: story.narration_scope || (story.narrated === false ? 'dialogue?' : null),
        place: story.place ? (story.place.name || 'unnamed') : null,
        cast: Object.keys(story.character_descriptions || {}),
        agent_prompt: fs.existsSync(path.join(dir, 'agent_prompt.txt')),
        character_sheets: fs.existsSync(path.join(dir, 'character_sheets.txt')),
        clips_downloaded: clips,
        final_video: finalFiles.length ? path.join(dir, finalFiles[0]) : null,
    };
}

// ── tool registry ------------------------------------------------------------
const TOOLS = [
    {
        name: 'list_presets',
        description: 'List the style presets in styles.json (id, label, narration scope, cast type, default length). Use the id as the `preset` argument of write_story.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => {
            const groups = [['Classic', STYLES_FILE], ['GENAI Presets', GENAI_STYLES_FILE]];
            const list = [];
            for (const [group, file] of groups) {
                const db = readJson(file, { styles: [] });
                for (const p of (db.styles || [])) {
                    list.push({
                        group, id: p.id, label: p.label, kind: p.kind,
                        narration_scope: p.narration_scope || null,
                        cast: p.cast || null, cast_types: p.cast_types || null,
                        default_duration: p.default_duration || null,
                    });
                }
            }
            return text(JSON.stringify(list, null, 2));
        },
    },
    {
        name: 'list_stories',
        description: 'List every story folder under stories/ with how far it has got (story JSON, agent prompt, downloaded clips, final video).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => {
            let dirs = [];
            try {
                dirs = fs.readdirSync(STORIES_DIR, { withFileTypes: true })
                    .filter((d) => d.isDirectory() && d.name !== 'old').map((d) => d.name);
            } catch (e) { return fail('Could not read the stories folder: ' + e.message); }
            const rows = [];
            for (const name of dirs) {
                const dir = path.join(STORIES_DIR, name);
                const storyFile = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('_story.json'));
                if (storyFile) rows.push(statusOf(path.join(dir, storyFile)));
            }
            return text(JSON.stringify(rows, null, 2));
        },
    },
    {
        name: 'new_project',
        description: 'Create a NEW Flow project in the automation browser (CDP) and return its URL, so each film gets its own clean project - the grid then holds only that film\'s clips. Run with probe:true first to dump the Flow home DOM if the New project control is not found.',
        inputSchema: {
            type: 'object',
            properties: {
                cdp: { type: 'integer', description: 'CDP port. Default 9222.' },
                probe: { type: 'boolean', description: 'Dump the Flow home controls and change nothing.' },
                no_create: { type: 'boolean', description: 'Do not click anything; just report the current project URL.' },
                instructions: { type: 'string', description: 'Path to a text file to paste into Agent Instructions (best effort).' },
                timeout: { type: 'integer', description: 'Seconds to wait for the new project URL. Default 60.' },
            },
            additionalProperties: false,
        },
        handler: async (a) => {
            const r = await doNewProject(a);
            return r.ok ? text(r.text) : fail(r.text);
        },
    },
    {
        name: 'generate_refs',
        description: 'Make the reference images INSIDE the current Flow project: Agent Mode off, paste each sheet/plate prompt from the story refs.json, generate it, and rename the tile to the simple character/place name (Maya, Leo, Apartment). No local files, no manual rename. Needs the Flow model set to an IMAGE model (Nano Banana / Imagen). Afterwards run run_agent with no_upload_refs:true so it @-mentions these tiles.',
        inputSchema: {
            type: 'object',
            required: ['story'],
            properties: {
                story: { type: 'string', description: 'Story JSON path or folder (reads its refs.json).' },
                only: { type: 'string', description: 'Generate just this one ref by name (retry a single failure).' },
                cdp: { type: 'integer', description: 'CDP port. Default 9222.' },
                wait: { type: 'integer', description: 'Seconds to wait per image. Default 180.' },
                dry: { type: 'boolean', description: 'List what it would do; generate nothing.' },
            },
            additionalProperties: false,
        },
        handler: async (a) => {
            const r = await doGenerateRefs(a);
            return r.ok ? text(r.text) : fail(r.text);
        },
    },
    {
        name: 'analyze_video',
        description: 'Watch a public YouTube video with Gemini and extract, EXHAUSTIVELY, (a) a style/format brief and (b) a content map: EVERY place/fact with its timestamp, plus a clip plan covering all of them in order. Fast videos name many countries - it must not compress them. Pass the returned content_map to write_story to ground its beats. Writes stories/_reference/<slug>.detail.txt and <slug>.content-map.json.',
        inputSchema: {
            type: 'object',
            required: ['url'],
            properties: {
                url: { type: 'string', description: 'A public YouTube URL (shorts or watch).' },
                preset: { type: 'string', description: 'Bias the suggested preset toward this id.' },
                seconds: { type: 'integer', description: 'Clip length to plan to. Default 8.' },
                clips: { type: 'integer', description: 'Force AT LEAST this many clips (spreads facts out instead of compressing).' },
                model: { type: 'string', description: 'Gemini model. Default gemini-3.6-flash.' },
                models: { type: 'array', items: { type: 'string' }, description: 'Fallback chain, newest first, e.g. ["gemini-3.8-flash","gemini-3.7-flash","gemini-3.6-flash"]. Overrides model.' },
                out: { type: 'string', description: 'Output folder. Default stories/_reference.' },
                keys: { type: 'array', items: { type: 'string' }, description: 'Gemini API keys.' },
            },
            additionalProperties: false,
        },
        handler: async (a) => {
            const r = await doAnalyzeVideo(a);
            return r.ok ? text(r.text) : fail(r.text);
        },
    },
    {
        name: 'write_story',
        description: 'Write a whole story package from a title and a preset (cast, outline, scenes, dialogue, place, sheet prompts) into stories/<slug>/. Costs Gemini calls, not Flow credits. Follow with build_prompt.',
        inputSchema: {
            type: 'object',
            required: ['title', 'preset'],
            properties: {
                title: { type: 'string', description: 'The video title.' },
                preset: { type: 'string', description: 'A preset id from list_presets, e.g. relationship-dialogue.' },
                detail: { type: 'string', description: 'The creator brief: genre, look, characters, beats. Free text.' },
                content_map: { type: 'string', description: 'Path to a content map from analyze_video (.content-map.json). Grounds the beats in its real places and order, and supplies title/preset if they are omitted.' },
                duration: { type: 'integer', description: 'Total seconds (multiple of scene_seconds). Default 56.' },
                scene_seconds: { type: 'integer', description: 'Seconds per clip. Default 8 (Veo 3.1 Lite max).' },
                aspect: { type: 'string', description: '"Flow" (default, set the ratio in Flow), or 16:9 / 9:16 / 1:1.' },
                video_model: { type: 'string', description: 'Video model for this project, e.g. "Veo 3.1 - Fast". "Flow" (default) leaves it alone.' },
                model: { type: 'string', description: 'Gemini model, e.g. gemini-3.6-flash.' },
                models: { type: 'array', items: { type: 'string' }, description: 'Fallback chain, newest first. Overrides model.' },
                out: { type: 'string', description: 'Output folder override (default stories/<slug>).' },
                cast: { type: 'string', description: 'Path to an alternative cast file.' },
                no_house_cast: { type: 'boolean', description: 'Design a fresh cast for this one story.' },
                force: { type: 'boolean', description: 'Overwrite an existing story folder.' },
                dry_run: { type: 'boolean', description: 'Print the prompts, call nothing.' },
                keys: { type: 'array', items: { type: 'string' }, description: 'Gemini API keys, tried in order.' },
            },
            additionalProperties: false,
        },
        handler: async (a) => {
            const r = await doWriteStory(a);
            return r.ok ? text((r.storyJson ? `story_json: ${r.storyJson}\n\n` : '') + r.text) : fail(r.text);
        },
    },
    {
        name: 'build_prompt',
        description: 'Build agent_prompt.txt from a story JSON. Stage 2 types this file into Flow. No network, no credits.',
        inputSchema: {
            type: 'object',
            required: ['story'],
            properties: {
                story: { type: 'string', description: 'Story JSON path, or the story folder.' },
                aspect: { type: 'string', description: '"Flow" (default), or 16:9 / 9:16 / 1:1.' },
                scene_seconds: { type: 'integer', description: 'Override seconds per clip.' },
            },
            additionalProperties: false,
        },
        handler: async (a) => {
            const r = await doBuildPrompt(a);
            return r.ok ? text(r.text) : fail(r.text);
        },
    },
    {
        name: 'run_agent',
        description: 'Drive Agent Mode in Flow: upload the reference images, type the prompt, @-mention the cast. DRY RUN unless submit:true (submit spends Veo credits). Requires Chrome open with CDP on --cdp.',
        inputSchema: {
            type: 'object',
            required: ['story'],
            properties: {
                story: { type: 'string', description: 'Story JSON path, or the story folder.' },
                submit: { type: 'boolean', description: 'false (default) = type only, spend nothing. true = generate clips.' },
                auto_approve: { type: 'boolean', description: 'With submit, click the agent\'s approval buttons. Default true.' },
                cdp: { type: 'integer', description: 'CDP port. Default 9222.' },
                watch: { type: 'integer', description: 'Seconds to watch after submit. Default 240.' },
                model: { type: 'string', description: 'Model hint, e.g. "veo3.1 low priority".' },
                video_model: { type: 'string', description: 'Video model this project must generate with, e.g. "Veo 3.1 - Fast" or "Omni 1.1 Flash". Set in Flow just before Generate. "Flow" (default) leaves the project on its own setting.' },
                voices: { type: 'array', items: { type: 'string' }, description: 'Flow voice names to attach, one per speaker (e.g. ["Orus"] or ["Orus","Achernar"]).' },
                no_upload_refs: { type: 'boolean', description: 'Do not upload sheets; only use an Image tile already present.' },
                generate_refs: { type: 'boolean', description: 'First generate the reference images in Flow (Agent off, renamed tiles), then generate the film from them.' },
                only: { type: 'string', description: 'With generate_refs, make just this one reference.' },
                wait: { type: 'integer', description: 'With generate_refs, seconds per image. Default 180.' },
                paste: { type: 'boolean', description: 'Paste the prompt as one blob instead of typing it.' },
            },
            additionalProperties: false,
        },
        handler: async (a) => {
            if (a.generate_refs) {
                const g = await doGenerateRefs({ story: a.story, only: a.only, cdp: a.cdp, wait: a.wait, video_model: a.video_model });
                if (!g.ok) return fail('generate_refs failed:\n' + g.text);
                // The tiles exist now, so point the agent at them instead of
                // uploading local files and duplicating the assets.
                a = Object.assign({}, a, { no_upload_refs: true });
            }
            const r = await doRunAgent(a);
            return r.ok ? text(r.text) : fail(r.text);
        },
    },
    {
        name: 'download_clips',
        description: 'Download the generated clips from the Flow project grid into a local folder, and write a contact sheet to check scene order.',
        inputSchema: {
            type: 'object',
            required: ['story'],
            properties: {
                story: { type: 'string', description: 'Story JSON path, or the story folder.' },
                out: { type: 'string', description: 'Output folder (default <story>/clips).' },
                cdp: { type: 'integer', description: 'CDP port. Default 9222.' },
                reverse: { type: 'boolean', description: 'Number newest-first. Default true.' },
                method: { type: 'string', description: 'auto (default) | src | menu.' },
                limit: { type: 'integer', description: 'Stop after N tiles.' },
                probe: { type: 'boolean', description: 'Inspect and dump only; download nothing.' },
                no_sheet: { type: 'boolean', description: 'Skip the contact sheet.' },
            },
            additionalProperties: false,
        },
        handler: async (a) => {
            const r = await doDownloadClips(a);
            return r.ok ? text(r.text) : fail(r.text);
        },
    },
    {
        name: 'join_clips',
        description: 'Concatenate the downloaded clips into one final .mp4 with ffmpeg. Use dry_run:true to print the join order first.',
        inputSchema: {
            type: 'object',
            required: ['story'],
            properties: {
                story: { type: 'string', description: 'Story JSON path or folder (uses its clips/ folder).' },
                clips_dir: { type: 'string', description: 'Explicit clips folder, instead of story.' },
                out: { type: 'string', description: 'Output file path.' },
                order: { type: 'string', description: 'Comma-separated clip basenames, in order.' },
                reverse: { type: 'boolean', description: 'Join back-to-front.' },
                reencode: { type: 'boolean', description: 'Re-encode instead of stream-copy.' },
                copy: { type: 'boolean', description: 'Force stream-copy even if the clips differ.' },
                dry_run: { type: 'boolean', description: 'Print the plan, write nothing.' },
            },
            additionalProperties: false,
        },
        handler: async (a) => {
            const r = await doJoin(a);
            return r.ok ? text(r.text) : fail(r.text);
        },
    },
    {
        name: 'pipeline_status',
        description: 'Report how far a story has got: scenes, place, cast, and whether the prompt, clips and final video exist.',
        inputSchema: {
            type: 'object',
            required: ['story'],
            properties: { story: { type: 'string', description: 'Story JSON path, or the story folder.' } },
            additionalProperties: false,
        },
        handler: async (a) => {
            const storyJson = resolveStoryJson(a.story);
            if (!storyJson) return fail(`No story JSON found at "${a.story}".`);
            return text(JSON.stringify(statusOf(storyJson), null, 2));
        },
    },
    {
        name: 'full_pipeline',
        description: 'Run the whole chain in one call: (optional) analyze_video -> write_story -> build_prompt -> (optional) run_agent -> download_clips -> join_clips. Give reference_url to learn the style and the real places from a YouTube video instead of writing a detail by hand. Generation is skipped unless generate:true, and is a dry run unless submit:true.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                preset: { type: 'string' },
                detail: { type: 'string' },
                reference_url: { type: 'string', description: 'Public YouTube URL to learn the style and content map from.' },
                content_map: { type: 'string', description: 'An existing content map, instead of reference_url.' },
                duration: { type: 'integer' },
                clips: { type: 'integer', description: 'Used only when match_ref is false: force at least this many clips.' },
                match_ref: { type: 'boolean', description: 'true (default): a pasted video link drives the length - the film is built to the reference video\'s own duration and the predefined clip count is ignored. false: the caller\'s clips/duration numbers win.' },
                scene_seconds: { type: 'integer' },
                aspect: { type: 'string' },
                model: { type: 'string', description: 'Gemini model for writing/analysing, e.g. gemini-3.6-flash.' },
                models: { type: 'array', items: { type: 'string' }, description: 'Gemini fallback chain, newest first.' },
                veo_model: { type: 'string', description: 'Veo model hint for Flow, e.g. "veo3.1 low priority".' },
                video_model: { type: 'string', description: 'Video model this project must generate with, e.g. "Veo 3.1 - Fast" or "Omni 1.1 Flash". "Flow" (default) leaves it alone.' },
                no_house_cast: { type: 'boolean' },
                new_project: { type: 'boolean', description: 'Create a fresh Flow project for this film before generating.' },
                project_url: { type: 'string', description: 'Generate into this existing project instead of the open tab.' },
                generate_refs: { type: 'boolean', description: 'First generate the reference images in Flow (Agent off, renamed tiles), then the film from them.' },
                no_upload_refs: { type: 'boolean', description: 'Do not upload sheets; only use Image tiles already in the project.' },
                wait: { type: 'integer', description: 'With generate_refs, seconds per image. Default 180.' },
                generate: { type: 'boolean', description: 'Run Agent Mode after the prompt is built.' },
                submit: { type: 'boolean', description: 'false = dry run, true = spend credits.' },
                auto_approve: { type: 'boolean' },
                cdp: { type: 'integer' },
                watch: { type: 'integer' },
                download: { type: 'boolean', description: 'Download clips after generation.' },
                join: { type: 'boolean', description: 'Join the clips into a final video.' },
                keys: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
        },
        handler: async (a) => {
            const parts = [];
            let contentMap = a.content_map || null;
            let detail = a.detail || '';
            // A pasted link drives the length unless the caller pins the numbers.
            // With match_ref ON the analyser is left free to plan as many clips
            // as the video needs; with it OFF we still ask it for at least the
            // requested count so a short source is spread, not compressed.
            const matchRef = a.match_ref !== false;
            const strictClips = matchRef ? 0 : (Number(a.clips) > 0 ? Number(a.clips)
                : (Number(a.duration) > 0
                    ? Math.ceil(Number(a.duration) / ((Number(a.scene_seconds) > 0 ? Number(a.scene_seconds) : 8)))
                    : 0));

            // A reference video supplies BOTH the look (its detail brief) and the
            // places and order (its content map). The map is what write_story
            // grounds its beats on, so the film follows the reference's structure
            // instead of inventing one.
            if (a.reference_url) {
                const av = await doAnalyzeVideo({
                    url: a.reference_url, preset: a.preset, clips: strictClips,
                    seconds: a.scene_seconds, model: a.model, models: a.models, keys: a.keys,
                });
                parts.push('## analyze_video\n' + av.text);
                if (!av.ok) return fail(parts.join('\n\n'));
                contentMap = av.contentMap;
                if (!detail && av.detailFile) {
                    try { detail = fs.readFileSync(av.detailFile, 'utf8').trim(); } catch (e) { /* gone */ }
                }
            }
            if (!a.title && !contentMap) return fail('Give a title, or a reference_url / content_map to take one from.');
            if (!a.preset && !contentMap) return fail('Give a preset (see list_presets), or a reference_url / content_map to suggest one.');

            const w = await doWriteStory({
                title: a.title, preset: a.preset, detail,
                content_map: contentMap, duration: storyDuration(a, contentMap, null),
                scene_seconds: a.scene_seconds, aspect: a.aspect, model: a.model, models: a.models,
                no_house_cast: a.no_house_cast, keys: a.keys,
            });
            parts.push('## write_story\n' + w.text);
            if (!w.ok) return fail(parts.join('\n\n'));
            const storyArg = w.storyJson;

            const b = await doBuildPrompt({ story: storyArg, aspect: a.aspect, scene_seconds: a.scene_seconds });
            parts.push('## build_prompt\n' + b.text);
            if (!b.ok) return fail(parts.join('\n\n'));

            if (!a.generate) {
                parts.push('## next\nStory and prompt are ready. Pass generate:true to drive Flow.');
                return text(parts.join('\n\n'));
            }

            let projectUrl = a.project_url || null;
            if (a.new_project) {
                const np = await doNewProject({ cdp: a.cdp });
                parts.push('## new_project\n' + np.text);
                if (!np.ok) return fail(parts.join('\n\n'));
                projectUrl = np.projectUrl;
            }
            let noUpload = !!a.no_upload_refs;
            if (a.generate_refs && a.submit) {
                const g = await doGenerateRefs({ story: storyArg, cdp: a.cdp, wait: a.wait, video_model: a.video_model });
                parts.push('## generate_refs\n' + g.text);
                if (!g.ok) return fail(parts.join('\n\n'));
                noUpload = true;
            }
            const r = await doRunAgent({ story: storyArg, cdp: a.cdp, watch: a.watch, model: a.veo_model, submit: a.submit, auto_approve: a.auto_approve, project_url: projectUrl, no_upload_refs: noUpload, video_model: a.video_model, voices: presetVoices(a.preset || (contentMap && contentMap.preset_suggestion)) });
            parts.push('## run_agent\n' + r.text);
            if (!r.ok || !a.submit) return r.ok ? text(parts.join('\n\n')) : fail(parts.join('\n\n'));

            if (a.download) {
                const dl = await doDownloadClips({ story: storyArg, cdp: a.cdp });
                parts.push('## download_clips\n' + dl.text);
                if (!dl.ok) return fail(parts.join('\n\n'));
            }
            if (a.join) {
                const j = await doJoin({ story: storyArg });
                parts.push('## join_clips\n' + j.text);
                if (!j.ok) return fail(parts.join('\n\n'));
            }
            return text(parts.join('\n\n'));
        },
    },
    {
        name: 'batch_pipeline',
        description: 'Make MANY videos in ONE call, strictly one at a time (Flow is a single browser, so runs must not overlap). Give references (YouTube URLs to learn from) and/or ideas (title + preset, written from scratch). Writes a full story package per item, and when generate:true and submit:true drives Flow for each. Use from/to to resume or slice a long batch. Generation SPENDS credits, so run once with generate:false to write all the stories, review them, then run again with generate:true.',
        inputSchema: {
            type: 'object',
            properties: {
                references: { type: 'array', items: { type: 'string' }, description: 'Public YouTube URLs. Each is analysed, then made into a film.' },
                ideas: {
                    type: 'array',
                    description: 'Story ideas to write from scratch.',
                    items: {
                        type: 'object', required: ['title', 'preset'],
                        properties: {
                            title: { type: 'string' },
                            preset: { type: 'string' },
                            detail: { type: 'string' },
                            duration: { type: 'integer' },
                        },
                        additionalProperties: false,
                    },
                },
                preset: { type: 'string', description: 'Default preset for references (a content map can otherwise suggest one).' },
                seconds: { type: 'integer' },
                duration: { type: 'integer' },
                clips: { type: 'integer', description: 'Used only when match_ref is false: force at least this many clips for each reference video.' },
                match_ref: { type: 'boolean', description: 'true (default): a pasted video link drives the length - the film is built to the reference video\'s own duration and the predefined clip count is ignored. false: the clips/duration numbers win. Applies to every preset.' },
                aspect: { type: 'string' },
                model: { type: 'string', description: 'Gemini model for analyse/write, e.g. gemini-3.6-flash.' },
                models: { type: 'array', items: { type: 'string' }, description: 'Gemini fallback chain, newest first.' },
                veo_model: { type: 'string', description: 'Veo model hint for Flow, e.g. "veo3.1 low priority".' },
                video_model: { type: 'string', description: 'Video model this project must generate with, e.g. "Veo 3.1 - Fast" or "Omni 1.1 Flash". "Flow" (default) leaves it alone.' },
                generate: { type: 'boolean', description: 'Drive Flow for each item. Off = write the stories only.' },
                submit: { type: 'boolean', description: 'true = actually spend credits.' },
                auto_approve: { type: 'boolean' },
                cdp: { type: 'integer' },
                watch: { type: 'integer' },
                download: { type: 'boolean' },
                join: { type: 'boolean' },
                new_project: { type: 'boolean', description: 'Create a fresh Flow project per film, so each grid holds only that film\'s clips.' },
                generate_refs: { type: 'boolean', description: 'Generate the reference images in Flow per film (Agent off, renamed tiles), then the film from them.' },
                no_upload_refs: { type: 'boolean', description: 'Do not upload sheets; only use Image tiles already in the project.' },
                wait: { type: 'integer', description: 'With generate_refs, seconds per image. Default 180.' },
                reuse: { type: 'boolean', description: 'true (default): if the story already exists, reuse it instead of analysing and writing again. Set false to regenerate.' },
                verbose: { type: 'boolean', description: 'true = every stage line plus each title/detail; false = one line per item.' },
                from: { type: 'integer', description: '1-based start index, to resume.' },
                to: { type: 'integer', description: '1-based end index, to slice.' },
                keys: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
        },
        handler: async (a) => {
            const items = [];
            for (const url of (a.references || [])) items.push({ kind: 'ref', url: String(url).trim() });
            for (const it of (a.ideas || [])) items.push({ kind: 'idea', title: String(it.title || '').trim(), preset: it.preset, detail: it.detail, duration: it.duration });
            if (!items.length) return fail('Give references (YouTube URLs) and/or ideas (title + preset).');
            const from = Math.max(1, a.from || 1);
            const to = Math.min(items.length, a.to || items.length);
            // CLIP COUNT vs VIDEO LENGTH. match_ref ON (the default) means a
            // pasted link is rebuilt to the reference's own length - a 2-minute
            // source asks for ~15 clips, not the 8 in the GUI box. OFF pins the
            // caller's clips/duration numbers for every preset.
            const matchRef = a.match_ref !== false;
            const out = [
                `Batch of ${items.length} item(s); running ${from}-${to}, one at a time.`,
                (a.generate && a.submit)
                    ? 'GENERATION IS ON - this spends Flow credits.'
                    : 'Writing stories only. Pass generate:true and submit:true to generate.',
            ];
            let done = 0, failed = 0;
            for (let i = from; i <= to; i++) {
                const it = items[i - 1];
                const label = it.kind === 'ref' ? it.url : it.title;
                out.push(`\n===== [${i}/${items.length}] ${label} =====`);
                // Mirror each step to stderr so a host (the GUI, a terminal) can
                // show live progress while this one long call is still running.
                log(`[batch ${i}/${items.length}] ${label}`);
                let contentMap = null, detail = it.detail || '', title = it.title, preset = it.preset || a.preset;
                if (a.verbose !== false && detail) {
                    out.push(`  detail: ${String(detail).replace(/\s+/g, ' ').slice(0, 200)}`);
                }
                // Each failure carries the stage's own last words, so a 503 or a
                // validation error is visible instead of a bare "FAILED at ...".
                const bad = (stage, res) => {
                    failed++;
                    const why = tailOf(res && res.text);
                    out.push(`  FAILED at ${stage}: ${why}`);
                    log(`[batch ${i}] FAILED at ${stage}: ${why}`);
                };

                // REUSE: if this film was already written in an earlier pass, skip
                // analysing and writing it again - go straight to building the
                // prompt and generating. That is what makes "write all, review,
                // then generate" cheap instead of re-paying for every video.
                let storyArg = null;
                let rewrite = false;
                if (a.reuse !== false) {
                    const cand = (it.kind === 'ref') ? storyForReference(it.url) : storyExists(it.title);
                    // Reuse only a story built for the length THIS run wants.
                    // Length is the field that moves: tick "Match the video link's
                    // own length" and the previous story is still on disk at the
                    // old count, so reuse kept serving 8 scenes for a 146s
                    // reference and the tick looked like it did nothing.
                    if (cand) {
                        const cm = (it.kind === 'ref') ? contentMapForReference(it.url) : null;
                        const want = storyDuration(a, cm, it);
                        const st = readJson(cand, null);
                        // Built length, as the story records it. video_duration is
                        // a display string ("64 seconds"), so derive it from the
                        // two numbers instead of parsing prose.
                        const have = st
                            ? (Number(st.total_scenes) || 0) * (Number(st.scene_seconds) || 0)
                            : 0;
                        if (want > 0 && have > 0 && have !== want) {
                            // The old story sits in the folder this run will write
                            // to, and write_story refuses to overwrite a story
                            // without --force. Flag it, so the rewrite below is
                            // allowed through instead of dying on that guard.
                            rewrite = true;
                            log(`[batch ${i}] existing story is ${have}s, this run wants ${want}s - rewriting`);
                            out.push(`  rewriting -> existing story is ${have}s, this run wants ${want}s`);
                        } else {
                            storyArg = cand;
                            out.push(`  reusing -> ${storyArg}`);
                            log(`[batch ${i}] reusing existing story ${storyArg}`);
                        }
                    }
                }

                if (!storyArg) {
                    if (it.kind === 'ref') {
                        log(`[batch ${i}] analysing the reference video...`);
                        const av = await doAnalyzeVideo({ url: it.url, preset: a.preset, seconds: a.seconds, clips: matchRef ? 0 : a.clips, model: a.model, models: a.models, keys: a.keys });
                        if (!av.ok) { bad('analyze_video', av); continue; }
                        contentMap = av.contentMap;
                        if (av.detailFile) { try { detail = fs.readFileSync(av.detailFile, 'utf8').trim(); } catch (e) { /* gone */ } }
                        out.push(`  analysed -> ${contentMap || '(no content map)'}`);
                        log(`[batch ${i}] analysed`);
                    }

                    const rd = refDuration(contentMap, a.seconds);
                    if (rd) log(`[batch ${i}] reference is ~${rd}s -> ${Math.round(rd / (a.seconds || 8))} clips at ${a.seconds || 8}s`);
                    log(`[batch ${i}] writing the story...`);
                    const w = await doWriteStory({
                        title, preset, detail, content_map: contentMap,
                        duration: storyDuration(a, contentMap, it), scene_seconds: a.seconds,
                        aspect: a.aspect, model: a.model, models: a.models, keys: a.keys,
                        force: rewrite,
                    });
                    if (!w.ok) { bad('write_story', w); continue; }
                    storyArg = w.storyJson;
                    out.push(`  story -> ${storyArg}`);
                }

                const b = await doBuildPrompt({ story: storyArg, aspect: a.aspect, scene_seconds: a.seconds });
                if (!b.ok) { bad('build_prompt', b); continue; }
                log(`[batch ${i}] prompt built -> ${storyArg}`);

                if (a.generate && a.submit) {
                    // One project per film: a fresh grid means the downloader can
                    // only find this film's clips, never a mix of two films.
                    let projectUrl = null;
                    if (a.new_project) {
                        log(`[batch ${i}] creating a new Flow project...`);
                        const np = await doNewProject({ cdp: a.cdp });
                        if (!np.ok) { bad('new_project', np); continue; }
                        projectUrl = np.projectUrl;
                        out.push(`  project -> ${projectUrl}`);
                        log(`[batch ${i}] project ${projectUrl}`);
                    }
                    let noUpload = !!a.no_upload_refs;
                    if (a.generate_refs) {
                        log(`[batch ${i}] generating the reference images in Flow...`);
                        const g = await doGenerateRefs({ story: storyArg, cdp: a.cdp, wait: a.wait, video_model: a.video_model });
                        if (!g.ok) { bad('generate_refs', g); continue; }
                        out.push('  refs -> generated and renamed in Flow');
                        log(`[batch ${i}] reference images done`);
                        noUpload = true;
                    }
                    log(`[batch ${i}] driving Flow (this can take a while)...`);
                    const r = await doRunAgent({ story: storyArg, cdp: a.cdp, watch: a.watch, model: a.veo_model, submit: true, auto_approve: a.auto_approve, project_url: projectUrl, no_upload_refs: noUpload, video_model: a.video_model, voices: presetVoices(preset) });
                    if (!r.ok) { bad('run_agent', r); continue; }
                    out.push('  generated.');
                    log(`[batch ${i}] generated`);
                    if (a.download) {
                        const dl = await doDownloadClips({ story: storyArg, cdp: a.cdp });
                        if (!dl.ok) { bad('download_clips', dl); continue; }
                        // The authoritative completion check: clips on disk. A
                        // project full of "usage limit"/failed tiles downloads
                        // nothing, and we must not join a partial or stale set.
                        const cDir = path.join(storyDirOf(storyArg), 'clips');
                        const got = fs.existsSync(cDir)
                            ? fs.readdirSync(cDir).filter((f) => /^scene-\d+\.mp4$/i.test(f)).length : 0;
                        if (!got) {
                            bad('download_clips', { text: 'no scene mp4s downloaded - not joining an empty or stale set.' });
                            continue;
                        }
                        out.push(`  downloaded ${got} clip(s).`);
                        log(`[batch ${i}] downloaded ${got} clip(s)`);
                        if (a.join) {
                            // Flow's grid is NEWEST-FIRST, so agent_download numbers
                            // the files in reverse scene order. Join them back-to-front
                            // or the whole film plays backwards (no hook, no payoff).
                            const j = await doJoin({ story: storyArg, reverse: true });
                            if (j.ok) { out.push('  joined.'); log(`[batch ${i}] joined`); }
                            else { bad('join_clips', j); }
                        }
                    }
                }
                done++;
            }
            out.push(`\nDone: ${done} ok, ${failed} failed, of ${to - from + 1} attempted.`);
            // "Show title + detail in the summary": on = every stage line, off =
            // one header per item plus the final count. Stage/detail lines are
            // the ones indented by two spaces.
            const body = (a.verbose === false)
                ? out.filter((ln) => !/^ {2}\S/.test(ln)).join('\n')
                : out.join('\n');
            return (failed && !done) ? fail(body) : text(body);
        },
    },
];

async function callTool(name, args) {
    const t = TOOLS.find((x) => x.name === name);
    if (!t) throw new Error('Unknown tool: ' + name);
    const invoke = () => t.handler(args || {});
    // Heavy stages spawn a Node process or drive the one Flow tab, so they run
    // strictly one at a time: a second generation must QUEUE behind the first,
    // not fight it for the same browser and CDP port. Fast local tools (status,
    // list, presets) skip the queue so they answer while a film is generating.
    return HEAVY.has(name) ? await enqueue(invoke) : await invoke();
}

// ── JSON-RPC over stdio ------------------------------------------------------
// A one-lane queue for the heavy stages. Flow automation is a single shared
// resource (one Chrome, one CDP port), so concurrent runs would corrupt each
// other; this makes them line up instead.
let jobChain = Promise.resolve();
function enqueue(fn) {
    const run = jobChain.then(fn, fn);   // run the next job even if the last failed
    jobChain = run.then(() => {}, () => {});
    return run;
}
const HEAVY = new Set([
    'analyze_video', 'new_project', 'generate_refs', 'write_story', 'run_agent',
    'download_clips', 'join_clips', 'full_pipeline', 'batch_pipeline',
]);

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

async function handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch (e) { log('ignoring a non-JSON line'); return; }
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    if (method === 'initialize') {
        const pv = (params && params.protocolVersion) || DEFAULT_PROTOCOL;
        send({
            jsonrpc: '2.0', id,
            result: {
                protocolVersion: pv,
                capabilities: { tools: {} },
                serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            },
        });
        return;
    }
    if (method === 'notifications/initialized' || method === 'initialized' ||
        method === 'notifications/cancelled' || method === 'notifications/progress') return;
    if (method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return; }
    if (method === 'tools/list') {
        send({
            jsonrpc: '2.0', id,
            result: {
                tools: TOOLS.map((t) => ({
                    name: t.name, description: t.description, inputSchema: t.inputSchema,
                })),
            },
        });
        return;
    }
    if (method === 'tools/call') {
        const name = params && params.name;
        const args = (params && params.arguments) || {};
        let result;
        try { result = await callTool(name, args); }
        catch (e) { result = fail(`Tool "${name}" failed: ${e && e.message ? e.message : e}`); }
        if (!isNotification) send({ jsonrpc: '2.0', id, result });
        return;
    }
    // Capabilities cover tools only, but some clients probe these anyway.
    if (method === 'resources/list') { send({ jsonrpc: '2.0', id, result: { resources: [] } }); return; }
    if (method === 'prompts/list') { send({ jsonrpc: '2.0', id, result: { prompts: [] } }); return; }
    if (isNotification) return;
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) handleLine(line).catch((e) => log('handler error: ' + e.message));
    }
});
process.stdin.on('end', () => process.exit(0));
process.on('uncaughtException', (e) => log('uncaught: ' + (e && e.stack || e)));
process.on('unhandledRejection', (e) => log('unhandled rejection: ' + (e && e.stack || e)));

log(`${SERVER_NAME} v${SERVER_VERSION} ready on stdio (${TOOLS.length} tools)`);
