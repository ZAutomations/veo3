#!/usr/bin/env node
/**
 * WRITE A STORY FROM A TITLE
 * ==========================
 * title + detail + duration + preset  ->  a whole story package on disk.
 *
 * WHAT IT PRODUCES
 *   stories/<slug>/<slug>_story.json     the story, in the schema stage 1 reads
 *   stories/<slug>/style_bible.md        the look, for you to read and keep
 *   stories/<slug>/character_sheets.txt  paste-ready image prompts, one per
 *                                        character, each asking for a multi-angle
 *                                        turnaround sheet in a single image
 *   stories/<slug>/character_refs/       empty; the sheets go here once generated
 *
 * WHY IT WRITES THE STORY JSON AND NOT THE AGENT PROMPT
 *   story_to_agent_prompt.js exists because a hand-written agent prompt once
 *   dropped the narrator voice-over and the silent-cast rule, and the agent
 *   invented dialogue. Generating the prompt directly would reopen exactly that.
 *   So this emits the JSON and stops; stage 1 derives the prompt from it.
 *
 * WHY THE CAST COMES FIRST, IN ITS OWN CALL
 *   Character descriptions are what hold a cast together across scenes. Generated
 *   independently they drift - one character watercolour, another cel-shaded,
 *   which is a real mismatch this repo has already produced by hand. So the cast
 *   is written first, in one call, from one cast_idiom, and every later call is
 *   handed that same cast text and told not to deviate from it.
 *
 * WHY THE OUTLINE IS SEPARATE FROM THE SCENES
 *   A 40-scene story cannot be written in one response - it truncates mid-JSON.
 *   The outline is short, so it always fits and always lands; scenes are then
 *   written in bounded batches against it. One call per story only works up to
 *   about a dozen scenes, and the old folder has a 47-scene story.
 *
 * Usage:
 *   node write_story.js --title "The Lantern Keeper" --detail "an old man tends
 *        a lighthouse" --duration 56 --preset ghibli
 *   node write_story.js ... --dry-run        show the prompts, call nothing
 *   node write_story.js --list-models        what this key can actually use
 *
 * Needs a Gemini API key: --key, or GEMINI_API_KEY, or gui_settings.json.
 * Several keys may be given. They are tried in order, and if one runs out of
 * quota the run continues on the next rather than dying part-way through a
 * story. Repeat --key, or separate them with commas in the env var, or keep a
 * "gemini_api_keys" array in gui_settings.json (the GUI's Script tab edits it).
 */

const fs = require('fs');
const path = require('path');

// ── IPv4 pin ─────────────────────────────────────────────────────────────────
// This machine's IPv6 route to Google is a black hole: the TCP connection opens
// but the response never arrives, so an IPv6-first fetch hangs until the abort
// fires and the call fails at random with "fetch failed". curl and the core
// https module are unaffected because they fall back to IPv4. Pin the whole
// process to IPv4 so a dead address family cannot stall a run. Module-level, so
// every script that requires this file (analyze_video, the MCP stages, ...) is
// covered too.
try {
    require('dns').setDefaultResultOrder('ipv4first');
    const net = require('net');
    if (typeof net.setDefaultAutoSelectFamily === 'function') net.setDefaultAutoSelectFamily(false);
} catch (e) { /* older Node: keep the defaults */ }

const HERE = __dirname;
const STORIES_DIR = path.join(HERE, 'stories');
const STYLES_FILE = path.join(HERE, 'styles.json');
// The second preset list. Kept apart so the classic list is untouched; searched
// after it, so an id works no matter which file it lives in.
const GENAI_STYLES_FILE = path.join(HERE, 'genai_styles.json');
const SETTINGS_FILE = path.join(HERE, 'gui_settings.json');
// The standing cast: the people who appear in every video. It sits at the root
// rather than inside a story folder because it outlives every story.
const HOUSE_CAST_FILE = path.join(HERE, 'house_cast.json');
const HOUSE_REFS_DIR = path.join(HERE, 'house_refs');
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── args ---------------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name, def = null) {
    const i = argv.indexOf(name);
    if (i < 0) return def;
    const v = argv[i + 1];
    return (v && !v.startsWith('--')) ? v : true;
}
function num(name, def) {
    const n = parseInt(flag(name), 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}
// Every occurrence of a repeatable flag, in the order given. `--key a --key b`.
function flags(name) {
    const out = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] !== name) continue;
        const v = argv[i + 1];
        if (v && !v.startsWith('--')) out.push(v);
    }
    return out;
}

let TITLE = typeof flag('--title') === 'string' ? flag('--title').trim() : '';
// The detail is free text and can run to a paragraph. Windows mangles long
// multi-line command-line arguments - the same reason agent_mode.js takes
// --file - so the GUI passes this through a file instead of inline.
const DETAIL_FILE = typeof flag('--detail-file') === 'string' ? flag('--detail-file') : null;
let DETAIL = typeof flag('--detail') === 'string' ? flag('--detail').trim() : '';
if (DETAIL_FILE) {
    try {
        DETAIL = fs.readFileSync(DETAIL_FILE, 'utf8').trim();
    } catch (e) {
        console.error(`Could not read --detail-file ${DETAIL_FILE}: ${e.message}`);
        process.exit(1);
    }
}
let PRESET_ID = typeof flag('--preset') === 'string' ? flag('--preset').trim() : '';

// A content map from analyze_video.js: the real places named in a reference
// video and the point made in each ~clip-length slice, in order. It is appended
// to the detail so call 1 writes one beat per segment, keeping the real place
// names and the reference's order, instead of inventing a structure. The title
// and the preset are taken from it only when the creator did not choose one.
const CONTENT_MAP_FILE = typeof flag('--content-map') === 'string' ? flag('--content-map').trim() : '';
let CONTENT_MAP = null;
if (CONTENT_MAP_FILE) {
    try {
        CONTENT_MAP = JSON.parse(fs.readFileSync(CONTENT_MAP_FILE, 'utf8'));
    } catch (e) {
        console.error(`Could not read --content-map ${CONTENT_MAP_FILE}: ${e.message}`);
        process.exit(1);
    }
    if (!TITLE && CONTENT_MAP.title_suggestion) TITLE = String(CONTENT_MAP.title_suggestion).trim();
    if (!PRESET_ID && CONTENT_MAP.preset_suggestion) PRESET_ID = String(CONTENT_MAP.preset_suggestion).trim();
    DETAIL = [DETAIL, contentMapBlock(CONTENT_MAP)].filter(Boolean).join('\n\n');
}
// 0 means "not given". A preset may declare `default_duration` - an animal
// kindness film is specified at 60-90s while a what-if explainer is not - and
// the preset's own number only applies when the creator stayed silent. An
// explicit --duration always wins, so this can never override a choice.
const DURATION_FLAG = num('--duration', 0);
let DURATION = DURATION_FLAG || 56;
const SECONDS = num('--seconds', 8);
const ASPECT = typeof flag('--aspect') === 'string' ? flag('--aspect').trim() : '16:9';
// Pinned rather than "gemini-flash-latest" on purpose: an alias silently changes
// the model under you between runs, so the same story idea writes differently
// from one week to the next with nothing on screen to say why. Pinning trades
// that for the occasional 404 - which is a loud, cheap failure that lists what
// the key can actually use, and the GUI's Script tab has a List models button
// that fills the dropdown from that same list.
//
// gemini-2.5-flash was the original default and was retired for new users within
// hours of this being written. Expect to change this again.
// A CHAIN, not one model. The newest flash is tried first; if it is overloaded
// (503) or not on this key (404) the next is used, then the next, so one busy
// model no longer fails a whole story. `--model a,b,c` overrides the chain, and
// a single `--model x` still works.
const DEFAULT_MODELS = 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.1-flash-lite';
const MODEL_FLAG = typeof flag('--model') === 'string' ? flag('--model') : '';
const MODELS = (MODEL_FLAG || DEFAULT_MODELS).split(',').map(s => s.trim()).filter(Boolean);
const MODEL = MODELS[0];
const BATCH = num('--scenes-per-call', 6);
const DRY = !!flag('--dry-run', false);
const FORCE = !!flag('--force', false);
const OUT_DIR = typeof flag('--out') === 'string' ? flag('--out') : null;
const LIST_MODELS = !!flag('--list-models', false);
// The standing cast. `--cast <file>` points somewhere other than house_cast.json,
// `--no-house-cast` designs a fresh cast for this one story.
const CAST_FILE = typeof flag('--cast') === 'string' ? flag('--cast').trim() : '';
const NO_HOUSE_CAST = !!flag('--no-house-cast', false);

// ── api keys -----------------------------------------------------------------
// Never printed in full. A key on a command line also lands in the shell history,
// which is why the env var and the settings file are checked first in practice.
//
// Several keys can be configured. They are used in the order given and a key
// that reports itself out of quota is dropped for the rest of the run, so a
// long story does not die on its last batch because the first key ran dry.
function apiKeys() {
    const out = [];
    const add = (v) => {
        const s = String(v == null ? '' : v).trim();
        // Comma-separated is allowed so an env var can carry the whole ring.
        for (const part of s.split(',')) {
            const k = part.trim();
            if (k && !out.includes(k)) out.push(k);
        }
    };

    // --key-index N narrows the ring to the Nth key in gui_settings.json alone.
    // The GUI needs to test stored keys one at a time, and passing the key
    // itself would put it in the process list - which is the whole reason the
    // settings file exists. Indexing the file avoids that entirely. It reads
    // only the saved list, not the env vars, so "3" means the third row of the
    // listbox on screen rather than something that shifts with the environment.
    const idx = num('--key-index', 0);
    if (idx > 0) {
        const saved = [];
        try {
            const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            if (Array.isArray(s.gemini_api_keys)) {
                for (const k of s.gemini_api_keys) {
                    const t = String(k || '').trim();
                    if (t) saved.push(t);
                }
            }
            if (!saved.length && typeof s.gemini_api_key === 'string' && s.gemini_api_key.trim()) {
                saved.push(s.gemini_api_key.trim());
            }
        } catch (e) { /* handled below */ }
        if (idx > saved.length) {
            console.error(`--key-index ${idx} but only ${saved.length} key(s) are saved.`);
            process.exit(1);
        }
        return [saved[idx - 1]];
    }

    for (const v of flags('--key')) add(v);
    for (const v of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY']) {
        if (process.env[v]) add(process.env[v]);
    }
    try {
        const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        if (Array.isArray(s.gemini_api_keys)) for (const k of s.gemini_api_keys) add(k);
        // Single-key settings files written before the ring existed still work.
        for (const k of ['gemini_api_key', 'gemini_key', 'GEMINI_API_KEY']) {
            if (typeof s[k] === 'string') add(s[k]);
        }
    } catch (e) { /* no settings file yet - fine */ }
    return out;
}

// Enough to tell two keys apart in a log without putting either one in it.
function maskKey(k) {
    const s = String(k || '');
    if (s.length <= 12) return '(short key)';
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

// A key that is merely rate-limited briefly and one that is out of credit for
// the month both arrive as 429, so the ring treats them the same: move on. The
// alternative is failing a 7-clip story on clip 6.
//
// Deliberately NOT matched: a 403 that says "permission" or "not valid". Those
// mean a key is wrong, not spent, and rotating past them would hide a real
// setup mistake behind "every key is out of quota" - which is a lie the user
// would chase for an hour.
function isQuotaError(e) {
    if (!e) return false;
    if (e.status === 429) return true;
    const m = String(e.message || '');
    if (/RESOURCE_EXHAUSTED|quota|rate.?limit|billing|exceeded/i.test(m)) return true;
    return e.status === 403 && /quota|billing|exceeded/i.test(m);
}

// A key whose project is denied (403) or whose token is refused (401) is
// unusable for this run, but that says nothing about the other keys in the
// ring. Rotate past it like a spent key; only when EVERY key is rejected does
// the error surface, so one dead project cannot fail a 10-key batch on its
// first call. The wording is kept distinct from quota so the log still tells
// the operator that a key was refused, not merely spent.
function isKeyRejected(e) {
    if (!e) return false;
    return e.status === 401 || e.status === 403;
}

class KeyRing {
    constructor(keys) {
        this.keys = keys.slice();
        this.dead = new Set();   // exhausted this run - never tried again
        this.i = 0;
    }
    get size() { return this.keys.length; }
    get current() { return this.keys[this.i]; }
    // "key 2/3 [AIza…9f2c]" - identifies a key for the operator without
    // disclosing it. Shown once at the start, not on every call.
    get label() {
        if (!this.size) return 'no key';
        if (this.size === 1) return `key [${maskKey(this.current)}]`;
        return `key ${this.i + 1}/${this.size} [${maskKey(this.current)}]`;
    }
    // Retire the current key and switch to the next one that has not been
    // retired. Returns false when the ring is empty, which is the caller's
    // signal to give up and report.
    retire() {
        this.dead.add(this.i);
        if (this.dead.size >= this.size) return false;
        for (let n = 1; n <= this.size; n++) {
            const j = (this.i + n) % this.size;
            if (!this.dead.has(j)) { this.i = j; return true; }
        }
        return false;
    }
}

// A hung connection would otherwise stall the run forever with no output, which
// looks identical to "still thinking". Generous, because a 16k-token JSON
// response is genuinely slow; this is a hung-socket guard, not a latency budget.
const TIMEOUT_MS = num('--timeout', 240) * 1000;

async function callApi(key, model, body) {
    const url = `${API}/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
        let msg = text;
        try { msg = JSON.parse(text).error?.message || text; } catch (e) { /* not json */ }
        const err = new Error(`${res.status} ${msg}`);
        err.status = res.status;
        throw err;
    }
    return JSON.parse(text);
}

async function listModels(key) {
    const res = await fetch(API, { headers: { 'x-goog-api-key': key } });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
    return (j.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));
}

// Gemini in JSON mode still occasionally wraps output in a fence or adds a word
// before the brace. Slice to the outermost braces rather than trusting the text.
// Walk to the end of the FIRST balanced {...} and parse only that. A model
// sometimes emits its object and then starts a second one, or adds a closing
// remark; slicing from the first brace to the LAST brace then swallows both and
// JSON.parse dies with "Unexpected non-whitespace character after JSON".
function firstJsonObject(t) {
    const start = t.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
        const c = t[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return t.slice(start, i + 1); }
    }
    return null;
}

function parseJson(raw) {
    const t = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const obj = firstJsonObject(t);
    if (!obj) throw new Error('no JSON object in the response');
    return JSON.parse(obj);
}

function geminiText(resp) {
    const cand = (resp.candidates || [])[0];
    if (!cand) {
        const blocked = resp.promptFeedback?.blockReason;
        throw new Error(blocked ? `blocked by the API: ${blocked}` : 'no candidates returned');
    }
    const parts = cand.content?.parts || [];
    const txt = parts.map(p => p.text || '').join('');
    if (!txt.trim()) {
        throw new Error(`empty response (finishReason: ${cand.finishReason || 'unknown'})`);
    }
    return txt;
}

// Transient server-side trouble: the request never reached the model, so the
// same key will usually succeed a moment later. A 429 is NOT this - that is
// quota, handled by moving to another key.
function isTransient(e) {
    if (!e) return false;
    if ([500, 502, 503, 504].includes(e.status)) return true;
    // A dropped socket or a DNS blip arrives with no status at all.
    return !e.status && /fetch failed|socket|ECONNRESET|ETIMEDOUT|network|aborted/i.test(String(e.message || ''));
}

// A response that came back but is not usable JSON: a second object glued on,
// a truncation, or a stray closing remark. Worth one more sample - the next
// one is usually clean - so it is retried like a transient error instead of
// killing the whole stage on a single bad generation.
function isParseError(e) {
    if (!e) return false;
    return /JSON|Unexpected (token|non-whitespace)|Unterminated|end of input/i.test(String(e.message || ''));
}

// A model this key simply cannot use: a hard 404, or a 400 naming the model.
// Distinct from quota (rotate the key) and from transient (retry the same one).
// When it happens, the caller moves to the next model in the chain.
function isModelError(e) {
    if (!e) return false;
    if (e.status === 404 || e.status === 400) {
        if (e.status === 400 && !/model/i.test(String(e.message || ''))) return false;
        return true;
    }
    return /not found|not supported|does not exist|unsupported|deprecated|no longer available/i
        .test(String(e.message || ''));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Five, not three: a Gemini "503 high demand" spike can outlast a few tries, and
// giving up early spends the whole analyse pass and writes nothing. Still bounded,
// so a genuinely dead endpoint fails in a few minutes rather than hanging.
const RETRIES = num('--retries', 5);

// One call, walked over a CHAIN of models and a ring of keys:
//   quota (429)        -> rotate the key, keep the model
//   transient (5xx/drop)-> retry the same model, then fall to the next model
//   model error (404)  -> fall to the next model straight away
// A single model string is accepted too, which is what the key-ring tests pass.
async function ask(ring, models, prompt, maxTokens) {
    const chain = (Array.isArray(models) ? models : [models]).map(m => String(m || '').trim()).filter(Boolean);
    // With a chain to fall back on, do not spend the full retry budget on one
    // busy model - two tries, then the next model. A lone model keeps all of it.
    const tries = chain.length > 1 ? Math.min(RETRIES, 2) : RETRIES;
    for (let mi = 0; mi < chain.length; mi++) {
        const model = chain[mi];
        let attempt = 0;
        for (;;) {
            const key = ring.current;
            try {
                const resp = await callApi(key, model, {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        temperature: 0.9,
                        maxOutputTokens: maxTokens,
                    },
                });
                return parseJson(geminiText(resp));
            } catch (e) {
                if (isQuotaError(e) || isKeyRejected(e)) {
                    if (!ring.retire()) throw e;
                    const why = isKeyRejected(e) ? 'was rejected' : 'is out of quota';
                    console.log(`\n  ${maskKey(key)} ${why} - switching to ${ring.label}`);
                    attempt = 0;   // a fresh key deserves a fresh set of retries
                    continue;
                }
                if (isTransient(e) || isParseError(e)) {
                    if (attempt < tries) {
                        attempt++;
                        const wait = attempt * 5000;
                        console.log(`\n  ${e.status || 'network'} from the API - retrying in ` +
                                    `${wait / 1000}s (${attempt}/${tries})`);
                        await sleep(wait);
                        continue;
                    }
                    if (mi < chain.length - 1) {
                        console.log(`\n  ${model} is still failing - falling back to ${chain[mi + 1]}`);
                        break;
                    }
                    throw e;
                }
                if (isModelError(e) && mi < chain.length - 1) {
                    console.log(`\n  ${model} is not usable with this key - falling back to ${chain[mi + 1]}`);
                    break;
                }
                throw e;
            }
        }
    }
    throw new Error('every model in the chain failed');
}

// ── preset -------------------------------------------------------------------
// The ground-truth block appended to the creator detail when --content-map is
// used. Plain text on purpose: it reaches call 1 AND call 2 through the same
// "DETAIL FROM THE CREATOR" line, so both see one order and the same place
// names. Hoisted, so it is defined before the module-level read that calls it.
function contentMapClips(cm) {
    if (Array.isArray(cm && cm.clips) && cm.clips.length) return cm.clips;
    if (Array.isArray(cm && cm.segments)) return cm.segments;
    return [];
}
function contentMapBlock(cm) {
    const clips = contentMapClips(cm);
    const facts = Array.isArray(cm && cm.facts) ? cm.facts : [];
    if (!clips.length && !facts.length) return '';
    const lines = clips.map((s, i) => {
        const when = (s.t_start || s.t_end) ? `[${s.t_start || '?'}-${s.t_end || '?'}] ` : '';
        const places = Array.isArray(s.places) ? s.places.join(', ') : String(s.places || '');
        const point = s.point || (Array.isArray(s.points) ? s.points.join('; ') : String(s.points || ''));
        const visual = s.visual ? ` Visual: ${s.visual}` : '';
        return `  ${i + 1}. ${when}${places ? places + ' - ' : ''}${point}${visual}`;
    });
    // The exhaustive fact list is repeated here on purpose. A fast reference
    // video names many places; the clip plan groups them, and without the full
    // list the writer quietly loses the ones that did not make a summary line.
    const factLines = facts.length
        ? ['', 'EVERY FACT that must appear somewhere, in your own words (do not drop any):',
            ...facts.map((x) => `  - ${(Array.isArray(x.places) ? x.places.join(', ') : String(x.places || ''))}` +
                `${x.t ? ` [${x.t}]` : ''}: ${x.detail || ''}`)]
        : [];
    return [
        'REFERENCE CONTENT MAP (ground truth from a reference video - follow this order',
        'and these exact place names):',
        ...lines,
        ...factLines,
        'The reference clips above give the ORDER and the CONTENT, not the scene count.',
        'Cover EVERY reference clip and EVERY fact below, in sequence, in your own words:',
        'split a reference clip across consecutive scenes when it carries more than one',
        'fact, never merge two reference clips into one scene, and never drop or reorder a',
        'fact. Match the reference point for point.',
        'Keep every place name exactly as written.',
        'Scene 1 is the HOOK: pose the single most counter-intuitive claim or question from',
        'the reference as an open loop (no greeting, never the first fact). The final scene',
        'is the payoff that closes that loop.',
    ].join('\n');
}

function presetLists() {
    const out = [];
    for (const f of [STYLES_FILE, GENAI_STYLES_FILE]) {
        try {
            const db = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (Array.isArray(db.styles)) out.push(...db.styles);
        } catch (e) { /* a missing optional list is fine */ }
    }
    return out;
}

function loadPreset(id) {
    const list = presetLists();
    const s = list.find(x => x.id === id);
    if (!s) {
        console.error(`Unknown preset id: ${id || '(none given)'}`);
        console.error(`Known ids: ${list.map(x => x.id).join(', ')}`);
        process.exit(1);
    }
    return s;
}

// ── the standing cast --------------------------------------------------------
// Every story used to invent its own cast, so every video had a different young
// woman and a different older one. Voice, format and thumbnail stayed the same
// and the faces did not, and a channel whose lead is a different person each
// week has no lead. house_cast.json designs them ONE time and every story reuses
// them; house_refs/ holds their reference sheets, made once, used by every story.
//
// Returns [] rather than throwing when the file is simply absent - no standing
// cast means "design one per story", which is how this worked before, not an
// error. A file that was asked for BY NAME and cannot be read is an error,
// because silently falling back to a fresh cast is the exact thing being fixed.
function loadHouseCast(file) {
    const asked = String(file || '').trim();
    const at = asked ? path.resolve(asked) : HOUSE_CAST_FILE;
    let raw;
    try {
        raw = fs.readFileSync(at, 'utf8');
    } catch (e) {
        if (asked) {
            console.error(`Could not read the cast file ${at}: ${e.message}`);
            process.exit(1);
        }
        return [];
    }
    let db;
    try {
        db = JSON.parse(raw);
    } catch (e) {
        console.error(`The cast file ${at} is not valid JSON: ${e.message}`);
        process.exit(1);
    }
    const list = Array.isArray(db) ? db : (db.characters || []);
    const out = list.filter(c => c && String(c.name || '').trim());
    if (asked && !out.length) {
        console.error(`The cast file ${at} names no characters.`);
        process.exit(1);
    }
    return out;
}

// Which presets get the standing cast, unasked. A preset whose cast is human and
// human only is what it was designed for - the two-hander dialogue genres. An
// animal film, a what-if explainer, or a genre that declares no types at all is
// left exactly as it was: dropping two Indian adults into it would be wrong, and
// silently changing what every other preset produces is worse than not having
// the feature. `--cast` overrides this for one run, `--no-house-cast` turns it
// off.
function houseCastApplies(p) {
    if (!p || p.cast === 'optional') return false;
    const t = Array.isArray(p.cast_types)
        ? p.cast_types.map(x => String(x).trim().toLowerCase()).filter(Boolean) : [];
    return t.length === 1 && t[0] === 'human';
}

// ── folder -------------------------------------------------------------------
function slugify(s) {
    return String(s).toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60) || 'untitled';
}

// ── prompts ------------------------------------------------------------------
// Both are `let` because a preset may carry `default_duration`, which is applied
// once the preset is loaded and before any prompt is built. Everything that
// reads them runs after that point.
// A content map plans its own number of beats - one per clip - so the film is
// as long as the reference needs, not the 56s default. An explicit --duration
// still wins, and a preset's default_duration is applied later than this.
if (CONTENT_MAP && !DURATION_FLAG) {
    const n = contentMapClips(CONTENT_MAP).length;
    if (n > 0) DURATION = n * SECONDS;
}
let SCENES = Math.max(1, Math.round(DURATION / SECONDS));
function usePresetDuration(p) {
    if (DURATION_FLAG || !p.default_duration) return false;
    DURATION = p.default_duration;
    SCENES = Math.max(1, Math.round(DURATION / SECONDS));
    return true;
}
// Narration has to finish inside the clip. Pace is PER-PRESET via
// `words_per_8s`: an Afrimax parable runs ~18 words per 8s, a relief-map
// explainer ~21. Without that field the default below applies (2.6 words/sec).
// Scaled by SECONDS so a shorter clip tightens the line instead of overflowing.
const DEFAULT_WORDS_PER_8S = 2.6;
function wordBudget(p) {
    const per8 = Number(p && p.words_per_8s);
    const rate = per8 > 0 ? per8 / 8 : DEFAULT_WORDS_PER_8S;
    return {
        max: Math.max(6, Math.round(SECONDS * rate)),
        hard: Math.max(8, Math.round(SECONDS * rate * 1.12)),
    };
}
// Spoken dialogue is a different budget: it is exchanged rather than read, so the
// clip has to hold two or three short turns plus the pause between them, and
// speech with interruptions carries fewer words per second than narration.
// Derived from SECONDS rather than fixed, so `--seconds 5` tightens the lines
// instead of silently overflowing them - which the narration budget above still
// does, and is the reason this one is not written the same way.
const D_WORDS_MAX = Math.max(6, Math.round(SECONDS * 3));
const D_WORDS_HARD = Math.max(8, Math.round(SECONDS * 3.75));
const mmss = (n) => `${Math.floor((n * SECONDS) / 60)}:${String((n * SECONDS) % 60).padStart(2, '0')}`;

function lookBlock(p, place) {
    // `narration_scope: "dialogue"` is the fourth way a video can carry sound:
    // the characters speak on screen and nobody narrates. It is the inverse of
    // every other preset, whose whole rule set is "the visuals illustrate the
    // narration" - so the narrator line is replaced rather than added to.
    const dialogue = p.narration_scope === 'dialogue';
    // `narration_scope: "intro"` means the voice-over exists only over the
    // opening clip. Every other preset narrates throughout, so an absent field
    // leaves the line exactly as it always was.
    const intro = p.narration_scope === 'intro';
    // The one place this film happens in. Supplied by the preset when the genre
    // always uses the same one, and by call 1 otherwise - so the caller passes
    // what it knows and the preset is the fallback. Call 1 itself passes
    // nothing, because it is the call that chooses the place.
    const fixed = String(place === undefined ? (p.setting || '') : place).trim();
    return [
        `LOOK: ${p.style}`,
        `CAST TEMPLATE (every character description must follow this shape): ${p.cast_idiom}`,
        `PALETTE: ${p.palette}`,
        `CAMERA: ${p.camera}`,
        // One place, named once, for the whole film. Scenes are written in
        // separate batches that share no state beyond the previous clip's
        // spoken line, so a genre set in a single place had nothing holding it
        // still: each batch quietly chose its own. Stating it here is what
        // reaches every batch, and buildStory repeats it in every [SHOT] line so
        // it survives even a clip that ignores this.
        ...(fixed
            ? [`SETTING (FIXED - the entire film happens in this one place and never leaves it): ${fixed}`]
            : []),
        // Fixed stage positions, the same idea one level down: the room is
        // locked, and so is who sits where. Repeated into every [SHOT] by
        // buildStory, so a clip that ignores the rule still carries it.
        ...(p.blocking
            ? [`BLOCKING (FIXED - never changes for the whole film): ${p.blocking}`]
            : []),
        // Free-text direction for genres that need it. An animal film has to be
        // told that the animal behaves like an animal; nothing in LOOK or CAMERA
        // says that, and left unsaid the model writes it as a small person.
        ...(p.direction ? [`DIRECTION: ${p.direction}`] : []),
        ...(dialogue
            ? ['SPEAKING: two people talk to each other on screen, in their own voices. There is no narrator, no voice-over, and nobody describes the scene out loud.']
            : intro
                ? [`NARRATOR: ${p.narration_voice} - heard over the opening clip only, never again.`]
                : [`NARRATOR: ${p.narration_voice}`]),
        // Free-text sound bed for genres carried by sound rather than words.
        // Independent of `narration_scope`: a preset can want a described sound
        // world while still narrating every clip.
        ...(p.sound_style ? [`SOUND: ${p.sound_style}`] : []),
        // Veo refuses a prompt that names or depicts a real person, and it can
        // refuse strong distress imagery outright. A refused clip is a wasted
        // clip, so the rule is stated once here - it reaches call 1 and call 2.
        'POLICY-SAFE (hard rule): never name or depict a real living or historical person, and never invoke their likeness - describe the ROLE instead ("the inventor", "the nurse", "the soldier"). Keep emotion restrained: no weeping or sobbing, no blood, gore, wounds or injuries, no weapon aimed at a person, no hate symbols, no real brand logos or trademarks. The video model refuses all of these.',
        `NEVER: ${p.avoid}`,
    ].join('\n');
}

function castPrompt(p, houseCast) {
    // The standing cast, when this run uses one. It replaces the whole cast task:
    // the model is not asked to design anybody, it is handed the people the
    // channel already has and told to write a story they could be in. Everything
    // the cast fields describe - identity profiles, sheet prompts, the shared
    // sheet background - belongs to a cast being INVENTED, so all of it goes.
    const fixed = Array.isArray(houseCast) && houseCast.length > 0;
    // Whether a cast is required is a property of the genre, not something to
    // leave to the model every time: a Ghibli story is about people, while a
    // "what if the earth stopped" explainer is about the earth. Presets carry
    // `cast: "required" | "optional"`, and an absent field means required so
    // every preset written before this behaves as it did.
    const optional = p.cast === 'optional';
    // A preset may declare which kinds of character its cast is drawn from. An
    // animal-kindness film has an animal AND a person, and the two need
    // genuinely different identity profiles: a person is held across cuts by
    // face, hair and a fixed wardrobe, an animal by breed, coat markings and
    // unchanging physical marks. One shared profile shape would end up
    // specifying the dog's wardrobe. A preset that declares no types keeps
    // exactly the human-shaped rule it had before.
    const types = Array.isArray(p.cast_types)
        ? p.cast_types.map(t => String(t).trim().toLowerCase()).filter(Boolean)
        : [];
    const typed = types.length > 0;
    const needAnimal = types.includes('animal');
    // A sound-led preset narrates the opening clip and nothing else, so the
    // beats have to be planned as a wordless film from the start. Left unsaid,
    // call 1 writes beats that only make sense with a line of narration over
    // them, and call 2 then has to invent narration to rescue them.
    const intro = p.narration_scope === 'intro';
    // A dialogue preset has no narrator at all, so its beats are conversational
    // turns rather than visual beats. Call 1 has to know that, or it plans a
    // montage that call 2 then has to fill with two people talking at nothing.
    const dialogue = p.narration_scope === 'dialogue';
    // A preset with no `setting` chooses its place per story, and no preset
    // hardcodes one any more - the two-hander dialogue presets used to lock a
    // tearoom for every conversation, which made them all happen in the same
    // room whatever the story was about. The `setting` field is still honoured
    // for a genre that genuinely always uses one place.
    const choosePlace = !p.setting;
    const castRule = fixed
        ? `4. PART OF THE CAST IS ALREADY DESIGNED - do not redesign it. This
   channel has a standing cast that appears in every video, so these faces have
   to be the same ones the audience saw last week. They are FIXED:
${houseCast.map(c => `     ${c.name} - ${c.description}`).join('\n')}
   Do NOT rename, redesign, replace or re-describe any of them, and do NOT write
   a description for them - they are attached after this call.
   Whoever ELSE the film needs IS yours to design, and you must design them if
   the story needs them, because a conversation cannot be held with nobody.
   Design as few as it can carry - one, or at most two - and nobody the film has
   no use for. The returning faces are never counted twice.
   For EACH character you design give:`
        : optional
        ? `4. Decide whether this video needs a cast at all.
   This genre is often about a process, a place or a system rather than a person.
   If the topic follows a phenomenon, an event or a "what if", it normally needs
   NO recurring character - the narrator carries it and the visuals are the
   subject. Inventing a stand-in anyway produces a pointless character and
   reference sheets nobody needs.
     - Topic about people and their choices -> design 2 or 3 characters below.
     - Topic about a process, place or system -> return "characters": [] and
       write nothing else about a cast.
   If you do write one, use 2 or 3 characters at most; a small cast stays consistent.
   For EACH character give:`
        : needAnimal
        ? `4. Design the cast. This genre is one animal and the person whose life it
   crosses - TWO characters: one animal, one human. A third is allowed only if
   the story genuinely cannot be told without them, because the video model
   accepts at most 3 reference images and a cast of three is the ceiling. Never
   return an empty list, and never a cast of people alone: the animal carries
   the story.
   For EACH character give:`
        : `4. Design the cast. Use 2 or 3 characters at most; a small cast stays
   consistent. This genre is about people, so there is always a cast - never
   return an empty list.
   For EACH character give:`;
    const castFields = optional ? `     (only when the list is not empty)` : '';
    // The identity profile, branched on type. Everything after the markers is
    // shared: the model must be told WHY the markers matter, or it treats them
    // as decoration and drops half of them.
    const typeField = typed
        ? `     "type"        - one of: ${types.join(', ')}\n`
        : '';
    const descField = typed
        ? `     "description" - 55 to 75 words, STARTING with "Same <name> throughout - "
                     and following the CAST TEMPLATE exactly, plus the rules for
                     its type:
                       animal - the exact breed or mix, build and size, base fur
                         colour, secondary coat markings, eye colour, and at least
                         TWO unchanging physical markers (a notched ear tip, a
                         chest patch, one white paw, an old scar). Those markers
                         are what hold the animal together across cuts - without
                         them the model renders a different animal in every clip.
                       human  - age, build, hair, face and skin tone, in one fixed
                         multi-layered wardrobe that never changes.
                     End with the NEVER guard restated as "NOT ..." so the model
                     cannot drift. Every character must be described in the SAME
                     medium.`
        : `     "description" - 55 to 75 words, STARTING with "Same <name> throughout - " and
                     following the CAST TEMPLATE exactly. State age, build,
                     clothing, hair, face, and the rendering medium. End with the
                     NEVER guard restated as "NOT ..." so the model cannot drift.
                     Every character must be described in the SAME medium.`;
    // A single front-facing image is a weak anchor: the model has one angle to
    // work from, invents the rest, and the face drifts from clip to clip. A
    // turnaround sheet - the same individual repeated from several angles plus a
    // facial close-up, on one canvas - gives it far more to hold onto. It is
    // still ONE image file, so it costs one of the three reference slots.
    // The place. Veo takes three reference images and the cast already spends
    // two, so exactly ONE place can be pinned per film - a story that wanders
    // between locations is a story whose locations cannot be referenced, and it
    // drifts. One place for the whole film is not a simplification, it is what
    // fits. Where the preset fixes the place (a genre that is always the same
    // room) it is supplied by the preset and the model is not asked; otherwise
    // call 1 picks it here, once, and every clip inherits it verbatim.
    //
    // The place is NOT assumed to be a room: a park bench, a kitchen table, a
    // hotel bed and a garden are all places, and the rule is only that it is the
    // same one for the whole film.
    const placeField = choosePlace ? `
5. Choose ONE place for this whole film, and describe it once. Every clip
   happens here and the place NEVER changes. It can be anywhere - a park bench,
   a kitchen table, a hotel bed, a garden, a stairwell, a car. What it cannot be
   is a different place from one clip to the next.
     - Pick somewhere that suits the story, then commit to it.
     - Give it the fixed details a camera keeps coming back to: the furniture or
       landmarks, what is on the walls or the ground, where the light comes from,
       and the time of day. Those details are what hold it still.
     - Say what must NEVER change: no redecorating, no moving to another place,
       no different time of day, nothing new appearing.
     - "place_name"        - ONE word, no spaces: "Tearoom", "Bedroom", "Kitchen",
       "Globe", "Courtyard". It becomes the image's asset name and the @mention
       the agent types, and a space in it makes that mention ambiguous - so keep
       it to a single word even if the place itself is described in detail below.
     - "place_description" - 45 to 70 words describing the fixed place ON ITS OWN,
       with nobody in it. This is repeated into every clip, so it must read
       identically every time.
     - "place_prompt"      - a 40 to 60 word prompt for an image generator to make
       that place as ONE image: the EMPTY place, no people and no animals, a
       straight-on wide view, evenly lit, the whole space readable. Same medium as
       the character sheets. Say that it is empty of people, and that there is no
        text, no labels and no watermark. Include the medium.` : '';


    // The outline step's number shifts by one when the model also had to choose
    // a place, so the list still reads as a list.
    const outlineNo = choosePlace ? '6' : '5';
    const sheetField = typed
        ? `     "sheet_prompt" - a 40 to 60 word prompt for an image generator to make that
                     character's reference sheet as ONE image containing the SAME
                     individual repeated from SEVERAL ANGLES: a full-body front
                     view, a full-body three-quarter view, a full-body side profile,
                     and a head-and-shoulders close-up of the face. Identical
                     outfit, hair and lighting in every view, evenly spaced in a row
                     on a plain neutral grey studio background. Say that it is one
                     identical individual in every view, and that there is no text,
                     no labels and no watermark. Include the medium.
                       animal - the breed and BOTH unchanging physical markers must
                         stay readable in every view. Every physical marker must be visible
                         in it, and the close-up is of the head, so both the face
                         and the coat markings are covered.
                       human  - the close-up is what locks the face; the full-body
                         views lock the wardrobe and the build.`
        : `     "sheet_prompt" - a 40 to 60 word prompt for an image generator to make that
                     character's reference sheet as ONE image containing the SAME
                     individual repeated from SEVERAL ANGLES: full-body front,
                     three-quarter and side profile views, plus a head-and-shoulders
                     close-up of the face. Identical outfit, hair and lighting in
                     every view, evenly spaced in a row on a plain neutral grey
                     studio background, with no text or labels. Include the medium.`;
    // Everything below the cast rule describes fields the model has to WRITE
    // into `characters`. With a standing cast there is nothing to write, so the
    // whole spec goes and the step numbering closes up behind it: 4 is the cast
    // (already done), 5 is the place, 6 is the outline - the numbers the model
    // is told to use are the numbers the list actually has.
    const castSpec = `
     "name"        - one word, capitalised, no spaces (e.g. "Mira")
${typeField}${descField}
${sheetField}
                     Every sheet in the cast must end with this exact background
                     phrase, word for word, with nothing added to it:
                     "plain neutral grey studio background"
                     Do not vary it per character - not "plain background", not
                     "plain gray background with a soft vignette". Sheets that
                     disagree on the background read as a different production.
`;
    // A fixed cast means the standing faces are NOT written here - they are
    // attached after this call, and asking for them twice invites the model to
    // re-describe one and drift it. Whatever it designs is additive: the cast of
    // the film is the standing cast plus these, merged in main().
    const castSkeleton = `"characters":[{"name":"",${typed ? '"type":"",' : ''}"description":"","sheet_prompt":""}]`;
    return `You are writing the character bible for a ${p.label} video.

TITLE: ${TITLE}
DETAIL FROM THE CREATOR: ${DETAIL || '(none given - infer a simple, specific story)'}
TOTAL LENGTH: ${DURATION} seconds across ${SCENES} clips of ${SECONDS} seconds.

${lookBlock(p, choosePlace ? '' : undefined)}

TASK
1. Write a one-sentence "description" of the whole video (max 30 words). It must
   describe WHAT HAPPENS, never what it looks like - the look is already fixed above.
2. Write a one-sentence "moral" (max 25 words).
3. Write "target_audience" (max 12 words).
${castRule}${castFields}${castSpec}${placeField}
${outlineNo}. Write an "outline": exactly ${SCENES} entries, one per clip.
     "title" - 2 to 5 words
     "beat"  - one sentence: what happens in this clip and what changes.
   The ${SCENES} beats must form ONE story with a turn and an ending, not a list
   of nice moments. Draw on these shapes that suit this look:
${(p.story_shapes || []).map(s => `     - ${s}`).join('\n')}${intro ? `
   This film is SOUND-LED. The only spoken words in it are the opening hook, so
   every beat after beat 1 has to land through what is SEEN and HEARD - a look,
   a movement, a sound. No beat may need a line of narration to make sense, and
   no beat may be a person explaining something.` : ''}${dialogue ? `
   This film is a CONVERSATION, not a montage. Every beat is something one of the
   two says to the other. Write each beat as the turn it turns
   on - the hook that stops the viewer, a rule, the doubt that pushes back, the
   aphorism worth repeating, the resolution - not as a description of what is
   seen. A beat that is only a picture has nothing for anyone to say.` : ''}

Return ONLY this JSON, no other text:
{"description":"","moral":"","target_audience":"",${choosePlace ? '"place_name":"","place_description":"","place_prompt":"",' : ''}${castSkeleton},"outline":[{"title":"","beat":""}]}`;
}

function scenesPrompt(p, cast, outline, from, to, soFar, place) {
    const { max: WORDS_MAX, hard: WORDS_HARD } = wordBudget(p);
    // The one place for the film, from the preset or from call 1. Absent only
    // for a preset that fixes no place and a caller that passed none, which is
    // the old behaviour.
    const fixed = String(place === undefined ? (p.setting || '') : place).trim();
    const intro = p.narration_scope === 'intro';
    // Dialogue-led genres invert the audio job completely: there is no narrator
    // to write for, and the lines belong to the cast. Left to itself the model
    // writes narration here, because narration is what every other preset wants.
    const dialogue = p.narration_scope === 'dialogue';
    const beatList = outline.slice(from, to).map((o, i) =>
        `  Clip ${from + i + 1} - "${o.title}": ${o.beat}`).join('\n');
    // A sound-led preset narrates only the opening clip, so a later batch can
    // follow a clip that has no script_line at all. Falling back to the sound
    // brief keeps "continue from this" meaningful instead of quoting an empty
    // string and telling the model the last clip ended in silence - and a
    // dialogue story has neither, so its last exchange is quoted instead.
    const lastSoFar = soFar[soFar.length - 1];
    const lastText = lastSoFar
        ? (lastSoFar.script_line || lastSoFar.sound_context
            || (lastSoFar.dialogue || []).map(d => `${d.speaker}: ${d.line}`).join(' / ')
            || '')
        : '';
    const prevLabel = dialogue
        ? 'THE PREVIOUS CLIP ENDED WITH THIS EXCHANGE (carry the conversation on from it, do not repeat it):'
        : 'THE PREVIOUS CLIP ENDED LIKE THIS (continue from it, do not repeat it):';
    const prev = lastText ? `\n${prevLabel}\n  "${lastText}"\n` : '';
    // A story with no cast is a real case, not a broken one: the visuals are the
    // subject and the narrator carries it. Spelling that out stops the model
    // from populating `characters` with people who were never designed, which
    // would then be handed to the agent as @-mentions that do not exist.
    const castBlock = cast.length
        ? `THE CAST - do not change, rename or redesign anyone:\n` +
          cast.map(c => `  ${c.name}: ${c.description}`).join('\n')
        : `THIS VIDEO HAS NO CAST. Do not invent characters, do not put people in\n` +
          `the foreground, and leave "characters" as [] for every clip. The subject\n` +
          `is the world itself - the process, the place, the scale. Distant unnamed\n` +
          `figures are fine if the beat calls for a sense of scale, but they are\n` +
          `scenery, not cast, and must not be listed.`;
    const charRule = cast.length
        ? `  "characters"        - array of the cast names actually VISIBLE in this clip.
                        Only who is on screen. Never list an absent character:
                        naming someone who is not there invites the model to
                        insert them.`
        : `  "characters"        - always [] for this video. It has no cast.`;

    // When the preset names one place, the room is not the model's to write.
    // It is supplied verbatim and repeated in every clip, so a clip that
    // re-describes the place is a clip fighting the setting - and one that moves
    // somewhere else is the exact drift this field exists to stop.
    //
    // The two-hander branch below is the stricter one: the place is locked AND
    // so are the seats, because the whole film is those two people in that one
    // frame. A preset that simply has a chosen place still gets the place lock
    // and is left free to frame it however the beat wants.
    const settingRule = !fixed
        ? `  "narrative_context" - 80 to 130 words describing what is ON SCREEN: the setting,
                        who is present, what they do, the light, the mood, and the
                        camera.`
        : dialogue
        ? `  "narrative_context" - 60 to 100 words describing what is ON SCREEN BESIDES
                        the place: who is present, what they do, the mood and the
                        camera. THE PLACE IS FIXED and already supplied - do NOT
                        describe it, do NOT redecorate it, do NOT move the two of
                        them anywhere else, and never name a different location.
                        THEIR POSITIONS ARE FIXED TOO (seated or standing, chosen
                        once) - whoever was on the left in clip 1 is on the left
                        in every clip: never swap their sides, never walk them out
                        of frame. Vary only the action, the expression and the
                        camera angle; the place and the positions stay put.
CAMERA ANGLE - pick it by who is speaking, and NAME it in the last sentence
  of the narrative_context:
    - one of them speaks  -> over-the-shoulder medium close-up from behind
                             the OTHER one, framed tight on the SPEAKER, the
                             listener a soft-focus edge in the foreground.
    - both speak, or a
      wordless beat       -> the wide two-shot at eye level, both in frame.
  Cut between angles, never pan, never zoom, and keep the same axis so their
  left and right positions never flip. The speaking face is the sharp one.`
        : `  "narrative_context" - 70 to 110 words describing what is ON SCREEN
                        BESIDES the place: who is present, what they do, the mood
                        and the camera. THE PLACE IS FIXED - it is supplied above
                        and is the same one in every clip. Do NOT describe it
                        again, do NOT redecorate it, do NOT move anyone anywhere
                        else, and never name a different location. Nothing new
                        appears in it and the time of day never changes. Vary
                        only the action, the expression and the camera angle.`;

    // Sound-led genres get a different audio job per clip. A narrated travelogue
    // over what should be a visual film is the failure this prevents: the model
    // narrates every beat by default, because every other preset does.
    const audioBlock = dialogue
        ? `
HOW THIS FILM SPEAKS - the two of them talk, on screen, to each other:
  There is NO narrator and NO voice-over anywhere in this film. Every word spoken
  is spoken by one of the cast above, out loud, in the room, to the other one.
  So do not write a line of narration, and never put a description of the scene
  into a character's mouth - nobody says what the camera can already see.
  Write speech as people actually say it: contractions, short sentences, one
  cutting the other off. Every clip needs at least one exchange.
`
        : intro
        ? `
AUDIO MODEL - this film is SOUND-LED, not narrated:
  Clip 1 opens with a single spoken hook. That is the ONLY narration in the whole
  film. Every clip after it has NO voice-over and NO dialogue - they are carried
  by the sounds of the place and by one continuous music bed underneath the lot.
  Writing narration into them is the main way this goes wrong. Give every clip a
  sound brief instead.
`
        : '';
    const fields = dialogue
        ? `  "scene_title"       - the beat's title
  "dialogue"          - the lines spoken in THIS clip, in the order they are said,
                        as an array of objects:
                          {"speaker": "<a cast name, spelled exactly as above>",
                           "line": "what they say, out loud"}
                        Two to four turns per clip, and at least one - this film is
                        a conversation, so a clip with nobody speaking has nothing
                        in it. Keep each line ${Math.round(D_WORDS_MAX / 2)} words or fewer;
                        across ALL the lines in one clip the total is ${D_WORDS_MAX} words
                        or fewer, hard limit ${D_WORDS_HARD}, because it all has to be
                        said aloud inside ${SECONDS} seconds. Punctuate for speech, not
                        for prose. The last line of the clip should be worth hearing
                        on its own.`
        : intro
        ? `  "scene_title"       - the beat's title
  "script_line"       - ONLY on clip 1. Leave it as "" for every other clip.
                        On clip 1 it is the HOOK: ONE sentence, ${WORDS_MAX} words or
                        fewer, hard limit ${WORDS_HARD}, read verbatim as voice-over and
                        fitting inside ${SECONDS} seconds. Present tense. It has to earn
                        the next 70 seconds, so open on the striking image.
  "sound_context"     - 25 to 45 words of SOUND, for EVERY clip including the first:
                        the real sounds this place would make and how the music sits
                        under them. Wind, an engine, gravel, rain, a kettle, a door,
                        breathing, an animal settling. Not a score description, and
                        never a line of narration in disguise.`
        : `  "scene_title"       - the beat's title
  "script_line"       - the NARRATION, spoken by the narrator. ONE sentence,
                        ${WORDS_MAX} words or fewer, hard limit ${WORDS_HARD}. It is read
                        verbatim as voice-over, so it must sound natural spoken
                        aloud and must fit inside ${SECONDS} seconds. Present tense.
                        Write it TTS-READY: spell every number out as words
                        ("seven thousand", never "7,000"); no ALL CAPS, no brackets,
                        no symbols and no emoji; contractions are fine.`;
    const skeleton = dialogue
        ? `{"scenes":[{"scene_title":"","dialogue":[{"speaker":"","line":""}],"narrative_context":"","characters":[]}]}`
        : intro
        ? `{"scenes":[{"scene_title":"","script_line":"","sound_context":"","narrative_context":"","characters":[]}]}`
        : `{"scenes":[{"scene_title":"","script_line":"","narrative_context":"","characters":[]}]}`;

    return `You are writing clips ${from + 1} to ${to} of a ${SCENES}-clip ${p.label} video.

TITLE: ${TITLE}
DETAIL FROM THE CREATOR: ${DETAIL || '(none given)'}
${lookBlock(p, fixed)}
${audioBlock}
${castBlock}
${prev}
THE BEATS FOR THESE CLIPS (one clip each, same order):
${beatList}

For EACH clip above, in order, return:
${fields}
${settingRule}
                        Describe the action and the emotion. Do NOT name a
                        rendering medium, a studio or an art style - the look is
                        already fixed above and naming it again is what makes
                        scenes drift apart.
                        The same goes for the cast's material words. Their
                        descriptions say "matte surface", "mannequin", "cel-shaded"
                        and so on because that is how the reference sheet must be
                        drawn - but inside the action, say what a person DOES and
                        what they WEAR. Write "the wind pulls at his coat", never
                        "the wind whips the fabric around his matte grey legs".
                        Repeating medium words in the action is what makes the
                        model render plastic where it should render a person.
${charRule}

Write exactly ${to - from} clips. Return ONLY this JSON, no other text:
${skeleton}`;
}

// ── assemble + validate ------------------------------------------------------
// A preset that declares `cast_types` is answered with a `type` per character,
// and that type decides which identity profile the reference sheet gets. Models
// drop fields, so a missing type is filled in when the preset leaves no
// ambiguity - and left blank when it does, because guessing "human" for the dog
// would hand an animal a person's wardrobe rules.
function normaliseCast(p, cast) {
    const types = Array.isArray(p.cast_types)
        ? p.cast_types.map(t => String(t).trim().toLowerCase()).filter(Boolean)
        : [];
    return (cast || []).map(c => {
        let t = types.length ? String(c.type || '').trim().toLowerCase() : '';
        if (types.length && (!t || !types.includes(t))) {
            t = types.length === 1 ? types[0] : '';
        }
        return { ...c, type: t };
    });
}

// Belt-and-braces safety pass. The writer is told the policy rule above, but a
// model still slips now and then; this strips the classes of wording the video
// model refuses outright, so a generated line cannot waste a clip.
const POLICY_SWAPS = [
    [/\b(weeping|sobbing|wailing|bawling)\b/gi, 'quietly moved'],
    [/\b(tears? (streaming|running|rolling|falling)|bursts? into tears|crying)\b/gi, 'eyes glistening'],
    [/\b(blood|bloody|gore|gory|wounds?|wounded|stabbed|beheaded|dismembered)\b/gi, 'dust'],
    [/\b(corpse|dead body|dead bodies|mutilated)\b/gi, 'still form'],
    [/\b(kill|kills|killed|murder|murdered|slaughtered)\b/gi, 'defeats'],
    [/\b(suicide|self-harm)\b/gi, 'despair'],
    [/\b(gun|rifle|pistol) (aimed|pointing|pointed) at\b/gi, 'held near'],
];
function sanitizeForPolicy(text) {
    let t = String(text == null ? '' : text);
    for (const [re, to] of POLICY_SWAPS) t = t.replace(re, to);
    // Trim only. Do NOT collapse inner runs of spaces: the dialogue AUDIO line
    // uses a two-space separator between speakers and that must survive.
    return t.trim();
}

function buildStory(p, cast, meta, scenes) {
    const descriptions = {}, references = {};
    for (const c of cast) {
        const key = c.name.toLowerCase();
        descriptions[key] = c.description;
        // A character from the standing cast already has a reference sheet, made
        // once and living in house_refs/ rather than in this story's folder -
        // and it carries the path to it. Writing the character_refs/ path here
        // instead would point stage 2 at a file nobody is ever asked to draw.
        references[key] = c.reference || `./character_refs/${key}.jpg`;
    }
    const total = scenes.length * SECONDS;
    const intro = p.narration_scope === 'intro';
    const dialogue = p.narration_scope === 'dialogue';
    // Both flags mean what they say, and a dialogue film is the one case where
    // neither is true: nobody narrates, and the cast is anything but silent.
    const scope = dialogue ? 'dialogue' : intro ? 'intro' : null;
    // The speakers, as written, so their lines read on screen with the same
    // spelling the agent will @-mention them by.
    const speech = (s) => (s.dialogue || [])
        .map(d => ({ speaker: String(d.speaker || '').trim(), line: String(d.line || '').trim() }))
        .filter(d => d.speaker && d.line);
    // The fixed place, in front of every shot, verbatim. Asking the model to keep
    // the place still is a request; repeating it into each [SHOT] is what makes
    // it true - whatever a clip's own text says, the place handed to the video
    // model is the same one in all of them. The clip's own description follows
    // it, so the two read as one scene brief.
    //
    // The place comes from the preset when the genre always uses the same one,
    // and otherwise from call 1, which chose it once for the whole film. Either
    // way there is exactly one, and it reaches every clip.
    // The place the film is locked to. A preset with no `setting` of its own -
    // which is all of them now - takes the one place call 1 chose for this
    // story. A preset that genuinely fixes its genre's place would keep that
    // instead. Either way exactly one place reaches every clip.
    const metaPlace = String(meta.place_description || '').trim();
    const useMetaPlace = !!metaPlace && !p.setting;
    const placeDesc = String(useMetaPlace ? metaPlace : (p.setting || '')).trim();
    const placeName = String(useMetaPlace
        ? (meta.place_name || '')
        : (p.setting ? (p.setting_name || '') : (meta.place_name || ''))).trim();
    const placePrompt = String(useMetaPlace
        ? (meta.place_prompt || '')
        : (p.setting ? (p.setting_prompt || '') : (meta.place_prompt || ''))).trim();
    const shot = (s) => [placeDesc, p.blocking, String(s.narrative_context || '').trim()]
        .filter(Boolean).join(' ');
    return {
        title: TITLE,
        description: meta.description,
        total_scenes: scenes.length,
        video_duration: `${total} seconds`,
        target_audience: meta.target_audience || '',
        moral: meta.moral,
        niche: p.label,
        style: p.style,
        // The one place the whole film happens in, so the agent prompt builder
        // can @-mention its reference image and the sheet writer can print its
        // prompt. `name` is the asset name the image must be given in Flow -
        // without it the plate cannot be referenced at all.
        ...(placeDesc
            ? { place: { name: placeName, description: placeDesc, prompt: placePrompt } }
            : {}),
        aspect_ratio: ASPECT,
        scene_seconds: SECONDS,
        // Explicit, so the prompt builder never has to guess from prose whether
        // this is a narrated story. Guessing is what dropped the voice-over rules
        // on stories that carry script_line but no veo3_prompt.
        narrated: !dialogue,
        // Only written when the preset asks for it, so every story written
        // before this field existed stays byte-identical. "intro" means the
        // voice-over runs over the opening clip and stops, "dialogue" means the
        // characters speak and nobody narrates; an absent field means the usual
        // narration throughout.
        ...(scope ? { narration_scope: scope } : {}),
        silent_cast: !dialogue,
        // A dialogue story has no narrator voice, and writing a stale one in
        // would give the agent a voice to cast even though nobody narrates.
        ...(dialogue ? {} : { narrator_voice: p.narration_voice }),
        scenes: scenes.map((s, i) => ({
            _scene_number: i + 1,
            _scene_title: s.scene_title,
            _timing: `${mmss(i)}-${mmss(i + 1)}`,
            scene_builder_action: 'text_to_video',
            extend_from_last_frame: false,
            script_line: dialogue ? '' : sanitizeForPolicy(s.script_line),
            // What is said in this clip, by whom. The whole film is this array.
            ...(dialogue ? { dialogue: speech(s) } : {}),
            // The sound brief only exists for sound-led presets. Naming the
            // literal sounds of the place is what stops a clip with no
            // voice-over from arriving with nothing on the audio track at all.
            ...(intro ? { sound_context: s.sound_context || '' } : {}),
            narrative_context: sanitizeForPolicy(shot(s)),
            // A clip with no narration carries its sound brief in the AUDIO slot
            // instead of an empty narrator line, which the video model would
            // otherwise fill with invented dialogue. A dialogue clip carries the
            // lines themselves, attributed, so the model knows who says what.
            veo3_prompt: sanitizeForPolicy(`[SHOT] ${shot(s)}\n[LOOK] ${p.style}\n[AUDIO] ` +
                (dialogue
                    ? (speech(s).length
                        ? speech(s).map(d => `${d.speaker} (on screen, speaking): "${d.line}"`).join('  ')
                        : 'No dialogue in this clip. Room tone and the ambient sound of the place only.')
                    : (intro && !String(s.script_line || '').trim())
                        ? `No voice-over in this clip. Natural sound only: ${s.sound_context}`
                        : `Narrator (V.O., ${p.narration_voice}): "${s.script_line}"`)),
            characters: (s.characters || []).map(x => String(x).toLowerCase()),
        })),
        character_descriptions: descriptions,
        character_references: references,
    };
}

function validate(story, cast, p = {}) {
    const { hard: WORDS_HARD } = wordBudget(p);
    const bad = [];
    const names = cast.map(c => c.name.toLowerCase());
    const types = Array.isArray(p.cast_types)
        ? p.cast_types.map(t => String(t).trim().toLowerCase()).filter(Boolean)
        : [];
    // A type the preset does not allow is a real error. A MISSING type is not -
    // the description still carries the identity, and the sheets fall back to
    // the neutral wording - so it is deliberately not a failure here.
    cast.forEach(c => {
        const t = String(c.type || '').trim().toLowerCase();
        if (types.length && t && !types.includes(t)) {
            bad.push(`"${c.name}" is typed "${t}", which ${p.label || 'this preset'} does not allow (${types.join(', ')})`);
        }
    });
    if (!story.description) bad.push('description is empty');
    if (!story.moral) bad.push('moral is empty');
    if (!story.scenes.length) bad.push('no scenes');
    // A sound-led story narrates one clip and then stops. Both halves of that
    // are checked, because each fails silently on its own: leftover narration
    // turns the film back into a documentary, and a missing sound brief leaves
    // the clip with an empty audio track for the video model to fill.
    const intro = p.narration_scope === 'intro';
    // A dialogue story is checked on the opposite things: every line has to
    // belong to somebody in the cast, and the whole exchange has to fit inside
    // the clip. A line attributed to a name that was never designed becomes an
    // @-mention for a Character that does not exist, which is the same failure
    // the character check below exists to prevent.
    const dialogue = p.narration_scope === 'dialogue';
    story.scenes.forEach((s, i) => {
        const n = i + 1;
        if (dialogue) {
            if (String(s.script_line || '').trim()) {
                bad.push(`clip ${n}: has a script_line, but this preset is spoken dialogue - there is no narrator`);
            }
            const lines = s.dialogue || [];
            if (!lines.length) {
                bad.push(`clip ${n}: no dialogue - this film is a conversation, so every clip needs a line`);
            }
            let words = 0;
            lines.forEach((d, j) => {
                const who = String(d.speaker || '').trim();
                const text = String(d.line || '').trim();
                if (!who) bad.push(`clip ${n}: dialogue line ${j + 1} has no speaker`);
                else if (cast.length && !names.includes(who.toLowerCase())) {
                    bad.push(`clip ${n}: "${who}" speaks but is not in the cast (${names.join(', ')})`);
                }
                if (!text) bad.push(`clip ${n}: dialogue line ${j + 1} has no words in it`);
                words += text ? text.split(/\s+/).length : 0;
            });
            if (words > D_WORDS_HARD) {
                bad.push(`clip ${n}: ${words} spoken words across ${lines.length} line(s), over the ${D_WORDS_HARD}-word limit for ${SECONDS}s of dialogue`);
            }
            // The speaker has to be on screen for the line to be said on
            // camera, and the model needs them listed to attach their reference.
            lines.forEach(d => {
                const who = String(d.speaker || '').trim().toLowerCase();
                if (who && names.includes(who) && !s.characters.map(x => String(x).toLowerCase()).includes(who)) {
                    bad.push(`clip ${n}: "${d.speaker}" speaks but is not listed in characters`);
                }
            });
        } else if (intro && n > 1) {
            if (String(s.script_line || '').trim()) {
                bad.push(`clip ${n}: has narration, but this preset narrates the opening clip only`);
            }
            if (!String(s.sound_context || '').trim()) {
                bad.push(`clip ${n}: no sound_context - with no narration this clip would be silent`);
            }
        } else if (!String(s.script_line || '').trim()) {
            bad.push(intro
                ? 'clip 1: no script_line - the opening hook is the only narration this film has'
                : `clip ${n}: no script_line - the agent would INVENT this scene`);
        } else {
            const w = s.script_line.trim().split(/\s+/).length;
            if (w > WORDS_HARD) bad.push(`clip ${n}: narration is ${w} words, over the ${WORDS_HARD}-word limit for ${SECONDS}s`);
        }
        if (!String(s.narrative_context || '').trim()) bad.push(`clip ${n}: no narrative_context`);
        // A story with one place has to have that place actually appear in every
        // clip, or the film quietly goes back to one place per scene - which is
        // what it did before this field existed. The place is read off the story
        // rather than the preset, because it can now come from either: a preset
        // that always uses the same one, or call 1 choosing it once for the film.
        // Checked here as well as written in, because a hand-written story never
        // passes through the scene prompt that would otherwise have supplied it.
        const place = String((story.place && story.place.description) || '').trim();
        if (place && !String(s.narrative_context || '').includes(place)) {
            bad.push(`clip ${n}: does not carry the film's fixed place - this story happens in one place, so every clip's narrative_context must contain it verbatim`);
        }
        // Only demand characters when the story actually has a cast. A
        // no-character story is legitimate (see `cast` in styles.json), but a
        // scene naming somebody who was never designed would become an
        // @-mention for a Character that does not exist.
        if (cast.length && !s.characters.length) bad.push(`clip ${n}: no characters listed`);
        s.characters.forEach(c => {
            if (!names.includes(c)) bad.push(`clip ${n}: "${c}" is not in the cast (${names.join(', ')})`);
        });
    });
    return bad;
}

// ── writers ------------------------------------------------------------------
function writePackage(dir, p, story, cast) {
    const slug = path.basename(dir);
    // The output folder first, explicitly. It used to be created as a side
    // effect of making character_refs/ inside it, so making that conditional
    // removed the only thing that created the folder at all - and a no-cast
    // story then failed to write with ENOENT after its API calls had been paid
    // for. Creating it here means it no longer depends on a cast existing.
    fs.mkdirSync(dir, { recursive: true });
    // Only make the sheets folder when there is something to put in it. An empty
    // character_refs/ on a no-cast video is an invitation to go looking for
    // sheets that were deliberately never asked for.
    if (cast.length) fs.mkdirSync(path.join(dir, 'character_refs'), { recursive: true });

    // Story JSON. LF and a trailing newline, like styles.json. (`cast` is passed
    // in rather than hung off `story` as a _cast key, so it cannot leak into the
    // written file - the schema has no such field and stage 1 would carry it.)
    const storyPath = path.join(dir, `${slug}_story.json`);
    fs.writeFileSync(storyPath, JSON.stringify(story, null, 2) + '\n', 'utf8');

    // The film's one place. It is written into the same file as the cast sheets
    // because it is made the same way, in the same sitting, and lives in the same
    // folder: one image, from a text prompt, uploaded before stage 2 runs.
    const place = story.place || {};
    const placeName = String(place.name || '').trim();
    const placeDesc = String(place.description || '').trim();
    const placePrompt = String(place.prompt || '').trim();

    // A character from the standing cast already has a sheet. It was made once,
    // when the cast was designed, and lives in house_refs/ where every story can
    // reach it - so asking the user to draw it again per story is exactly the
    // work this feature exists to remove. Sheet blocks are written only for a
    // cast invented HERE, and the place plate is written either way because the
    // place is the one thing that is still different in every film.
    const standing = cast.filter(c => c.reference);
    const drawn = cast.filter(c => !c.reference);

    if (drawn.length || placeDesc) {
        const hasAnimal = drawn.some(c => c.type === 'animal');
        const sheets = Object.entries(story.character_descriptions)
            .filter(([k]) => drawn.some(c => c.name.toLowerCase() === k))
            .map(([k, desc]) => {
                const c = drawn.find(x => x.name.toLowerCase() === k) || {};
                return [
                    `=== ${k.toUpperCase()} ===${c.type ? `   (${c.type})` : ''}`,
                    `save as: character_refs/${k}.jpg`,
                    '',
                    // An animal sheet has one job a human sheet does not: it has to
                    // make the breed and the coat markings readable, because those,
                    // not a face, are what the video model reproduces from cut to cut.
                    ...(c.type === 'animal'
                        ? ['This is an ANIMAL - one image, several angles. The breed and',
                           'the coat markings must stay readable across the views. Every',
                           'physical marker listed below must be visible somewhere in it,',
                           'or the video model will not reproduce them.',
                           '']
                        : []),
                    '-- image prompt --',
                    c.sheet_prompt || '(none generated - describe the character in the medium above)',
                    '',
                    '-- identity text (must match this exactly in the story JSON) --',
                    desc,
                ].join('\n');
            }).join('\n\n');

        // One place for the whole film - and the reason it needs an IMAGE rather
        // than one more sentence of instruction. Every clip of the tearoom story
        // already carried the place VERBATIM in its narrative_context, and the
        // place still drifted between clips. Words alone did not hold it, which is
        // the same finding that made the cast sheets images. So the place gets a
        // plate: one picture of the empty room, mentioned with @Name in stage 2,
        // handed to the model as reference pixels.
        const placeBlock = placeDesc ? [
            `=== PLACE - ${(placeName || p.label || 'the film').toUpperCase()} ===`,
            `save as: character_refs/${placeName || 'place'}.jpg`,
            '',
            'This is the ONE place this film happens in. Every clip is shot here,',
            'with the same furniture and the same light. Generate it as ONE image',
            'of the place EMPTY - no people and no animals - seen straight on and',
            'wide, evenly lit, the whole space readable.',
            '',
            '-- image prompt --',
            placePrompt || '(none generated - describe the place in the medium above)',
            '',
            '-- place text (must match this exactly in the story JSON) --',
            placeDesc,
        ].join('\n') : '';

        // The same prompts, machine-readable, so a Flow-side generator can make
        // the images without a human copying them out of character_sheets.txt.
        // ONE simple name per asset - "maya", not "maya_reference_sheet" - because
        // that name becomes the Flow tile name and the @mention the agent types.
        const refsOut = [];
        for (const c of drawn) {
            const k = c.name.toLowerCase();
            refsOut.push({ name: c.name, file: `${k}.jpg`, kind: 'character',
                           prompt: c.sheet_prompt || '' });
        }
        if (placeDesc) {
            refsOut.push({ name: placeName || 'place', file: `${placeName || 'place'}.jpg`,
                           kind: 'place', prompt: placePrompt || '' });
        }
        if (refsOut.length) {
            fs.writeFileSync(path.join(dir, 'refs.json'),
                JSON.stringify({ refs: refsOut }, null, 2) + '\n', 'utf8');
        }

        const body = [sheets, placeBlock].filter(Boolean).join('\n\n');
        const head = drawn.length
            ? `Reference sheets for "${story.title}" - the cast${placeDesc ? ' and the place' : ''}\n` +
              `Generate each one, then SAVE IT in this story's character_refs/\n` +
              `folder under the name given below.\n`
            : `Reference image for "${story.title}" - the place\n` +
              `Generate it, then SAVE IT in this story's character_refs/ folder\n` +
              `under the name given below.\n`;
        // A standing cast needs saying out loud here, because this file is the
        // one place a reader expects to find a sheet to make for every character
        // in the film, and its absence otherwise reads as a missing step. The
        // same note is where a sheet that was never actually drawn gets caught:
        // stage 2 skips a reference whose file is missing without failing, so a
        // silent skip here becomes a cast that drifts with no error anywhere.
        const missing = standing.filter(c => {
            const rel = String(c.reference || '').replace(/^\.\//, '');
            return rel && !fs.existsSync(path.resolve(HERE, rel));
        });
        const standingNote = standing.length
            ? `\nThe cast of this film - ${standing.map(c => c.name).join(', ')} - already has\n` +
              `its reference sheets. They were made once and live in ${path.basename(HOUSE_REFS_DIR)}/ at the\n` +
              `top of the project, so there is nothing to redraw for this story and no\n` +
              `sheet block for them below. Stage 2 uploads them from there and\n` +
              `${standing.map(c => `@${c.name}`).join(' and ')} resolves to the same file in every story.\n` +
              (missing.length
                  ? `\nNOT MADE YET: ${missing.map(c => c.reference).join(', ')}\n` +
                    `That file does not exist, and stage 2 skips a reference it cannot\n` +
                    `open WITHOUT failing - so the film would generate with no reference\n` +
                    `image for ${missing.map(c => c.name).join(' or ')} and the face would drift. Draw it before stage 2.\n`
                  : '')
            : '';

        fs.writeFileSync(path.join(dir, 'character_sheets.txt'),
            head +
            `Do NOT create a Flow Character for it, and do not touch the Character\n` +
            `tab. A Flow Character is re-invented for every clip, which is what made\n` +
            `faces and wardrobes drift from cut to cut. A plain image mentioned with\n` +
            `@Name is handed to the model as reference pixels and holds. Stage 2 does\n` +
            `that upload and mention for you - you only supply the file.\n` +
            (drawn.length
                ? `Every sheet must be made with the same medium or the cast will not match.\n` +
                  `Each sheet is ONE image file showing the same individual from several\n` +
                  `angles. Keep it to one file per character: the video model accepts at\n` +
                  `most 3 reference images, and the place plate takes one of those slots -\n` +
                  `so a cast of 2 or 3 is the ceiling.\n`
                : '') +
            (hasAnimal
                ? 'The animal sheets must make the breed and every coat marker\n' +
                  'readable from more than one angle - those, not a face, are what\n' +
                  'hold an animal together from cut to cut.\n'
                : '') +
            standingNote +
            '\n' + body + '\n', 'utf8');
    }

    const bible = [
        `# ${story.title} - style bible`,
        '',
        `Preset: **${p.label}** (\`${p.id}\`, ${p.kind})`,
        `Format: ${story.aspect_ratio}, ${story.scene_seconds}s per clip, ${story.total_scenes} clips, ${story.video_duration}`,
        '',
        '## The look',
        p.style,
        '',
        '## Cast template',
        p.cast_idiom,
        '',
        '## Palette',
        p.palette,
        '',
        '## Camera',
        p.camera,
        '',
        ...(p.direction ? ['## Direction', p.direction, ''] : []),
        ...(p.narration_scope === 'dialogue'
            ? ['## Voices',
               'No narrator and no voice-over. The cast speak on screen, to each other,',
               'and every word in the film comes out of one of their mouths.',
               '',
               '## Script',
               ...story.scenes.map(sc => {
                   const who = (sc.dialogue || []).map(d => `**${d.speaker}:** "${d.line}"`);
                   return `- *${sc._scene_title}* — ${who.length ? who.join(' ') : '(silent beat)'}`;
               }),
               '']
            : ['## Narrator',
               p.narration_voice,
               ...(p.narration_scope === 'intro'
                   ? ['', 'Heard over the opening clip only. Clips 2 onward carry no voice-over', 'at all - they run on their own sound and the music under it.', '']
                   : [''])]),
        ...(p.sound_style ? ['## Sound', p.sound_style, ''] : []),
        '## Never',
        p.avoid,
        '',
        '## Story shapes that suit this look',
        ...(p.story_shapes || []).map(s => `- ${s}`),
        '',
        ...(placeDesc
            ? ['## The place',
               (placeName ? `**${placeName}** - the one place this film happens in.` :
                            'The one place this film happens in.') +
               ' Every clip is shot here and it',
               'never changes: same furniture, same light, same time of day. The plate',
               'is in `character_sheets.txt` - generate it, save it as',
               `\`character_refs/${placeName || 'place'}.jpg\`, and mention it with ` +
               `\`@${placeName || 'Place'}\` so the`,
               'model is handed the pixels rather than one more description of them.',
               '',
               placeDesc,
               '']
            : []),
        ...(drawn.length
            ? ['## Cast',
               ...Object.entries(story.character_descriptions).map(([k, v]) => `**${k}** - ${v}`),
               '',
               '## What happens next',
               ...(placeDesc
                   ? ['1. Generate the sheets AND the place plate from `character_sheets.txt`',
                      '   (Whisk or any image tool), and save each one into `character_refs/`',
                      '   under the name it gives.',
                      '2. Do not upload them as Flow Characters. Stage 2 uploads each sheet as a',
                      '   plain image and mentions it with `@Name`, which is what holds the cast',
                      '   together; a Flow Character drifts between clips. The place plate is',
                      '   mentioned the same way.',
                      '3. Stage 1: `npm run agent:prompt -- stories/' + slug + '/' + slug + '_story.json`',
                      '4. Then the usual stages 2-4.',
                      '']
                   : ['1. Generate the sheets from `character_sheets.txt` (Whisk or any image tool)',
                      '   and save each one into `character_refs/` under the name the sheet gives.',
                      '2. Do not upload them as Flow Characters. Stage 2 uploads each sheet as a',
                      '   plain image and mentions it with `@Name`, which is what holds the cast',
                      '   together; a Flow Character drifts between clips.',
                      '3. Stage 1: `npm run agent:prompt -- stories/' + slug + '/' + slug + '_story.json`',
                      '4. Then the usual stages 2-4.',
                      ''])]
            : standing.length
            ? ['## Cast - the standing cast',
               ...Object.entries(story.character_descriptions).map(([k, v]) => `**${k}** - ${v}`),
               '',
               'These are the channel\'s standing cast, from `house_cast.json`. They appear',
               'in every video, and their reference sheets were made once - they are in',
               '`house_refs/` at the top of the project, not in this story\'s folder, so',
               'there is nothing to redraw here.',
               '',
               '## What happens next',
               ...(placeDesc
                   ? ['1. Generate the place plate from `character_sheets.txt` and save it',
                      `   into \`character_refs/\` as \`${placeName || 'place'}.jpg\`.`,
                      '2. Nothing to draw for the cast. Stage 2 uploads their sheets from',
                      '   `house_refs/` itself, as plain images, and mentions `@Name`. Do not',
                      '   make Flow Characters - they drift between clips.',
                      '3. Stage 1: `npm run agent:prompt -- stories/' + slug + '/' + slug + '_story.json`',
                      '4. Then the usual stages 2-4.',
                      '']
                   : ['1. Nothing to draw. Stage 2 uploads the cast sheets from `house_refs/`',
                      '   itself, as plain images, and mentions `@Name`. Do not make Flow',
                      '   Characters - they drift between clips.',
                      '2. Stage 1: `npm run agent:prompt -- stories/' + slug + '/' + slug + '_story.json`',
                      '3. Then the usual stages 2-4.',
                      ''])]
            : ['## Cast',
               'None. This topic is about the world rather than a person, so no',
               'character sheets were written and there are no reference images to',
               'upload before stage 1. Distant unnamed figures are scenery.',
               '',
               '## What happens next',
               ...(placeDesc
                   ? ['1. Generate the place plate from `character_sheets.txt` and save it',
                      `   into \`character_refs/\` as \`${placeName || 'place'}.jpg\`.`,
                      '2. Stage 1: `npm run agent:prompt -- stories/' + slug + '/' + slug + '_story.json`',
                      '3. Then the usual stages 2-4.',
                      '']
                   : ['1. No reference sheets to make and nothing to upload - skip straight to stage 1.',
                      '2. Stage 1: `npm run agent:prompt -- stories/' + slug + '/' + slug + '_story.json`',
                      '3. Then the usual stages 2-4.',
                      ''])]),
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'style_bible.md'), bible, 'utf8');

    return storyPath;
}

// ── main ---------------------------------------------------------------------
// Guarded so the internals can be required by a test. Everything above is pure -
// build a story, validate it, write it - and only this block touches the network.
if (require.main === module) (async () => {
    const ring = new KeyRing(apiKeys());

    if (LIST_MODELS) {
        if (!ring.size) { console.error('No API key. Set GEMINI_API_KEY or pass --key.'); process.exit(1); }
        // With a ring, list against the first key that answers - a key with no
        // quota left still lists models, so this is not a quota test.
        let lastErr = null;
        for (let n = 0; n < ring.size; n++) {
            try {
                for (const m of await listModels(ring.current)) console.log('  ' + m);
                return;
            } catch (e) { lastErr = e; if (!ring.retire()) break; }
        }
        console.error('Could not list models:', lastErr ? lastErr.message : 'no key worked');
        process.exit(1);
    }

    if (!TITLE) {
        console.error('Need --title. See the header of this file for usage.');
        process.exit(1);
    }
    if (!PRESET_ID) {
        console.error('Need --preset. Run `npm run styles` for the ids.');
        process.exit(1);
    }

    const p = loadPreset(PRESET_ID);
    // A preset may carry its own length - an animal kindness film is specified
    // at 60-90s, where most genres are happy at 56. Applied here, before the
    // prompts are built and before the run is described on screen, so the
    // printed duration is the one that actually gets used. An explicit
    // --duration wins and this does nothing.
    const fromPreset = usePresetDuration(p);
    const slug = slugify(TITLE);
    const dir = OUT_DIR || path.join(STORIES_DIR, slug);

    // The standing cast, decided before anything is asked of the API. Whether
    // these characters exist is a choice the channel made once, so it is not
    // re-rolled per story - and when it applies, the model is never asked to
    // design a cast at all.
    const house = loadHouseCast(CAST_FILE);
    const houseCast = (!NO_HOUSE_CAST && house.length && (CAST_FILE || houseCastApplies(p)))
        ? normaliseCast(p, house)
        : [];

    console.log(`\n  title    : ${TITLE}`);
    console.log(`  preset   : ${p.label}  [${p.id}]`);
    console.log(`  cast     : ${houseCast.length
        ? `the standing cast - ${houseCast.map(c => c.name).join(', ')}` +
          `  (${CAST_FILE ? path.basename(path.resolve(CAST_FILE)) : 'house_cast.json'})`
        : `${p.cast === 'optional' ? 'decided per story' : 'designed per story'}` +
          (NO_HOUSE_CAST && house.length ? '  (--no-house-cast)' : '')}`);
    console.log(`  format   : ${ASPECT}, ${SECONDS}s per clip`);
    console.log(`  duration : ${DURATION}s  ->  ${SCENES} clips` +
                (fromPreset ? `  (the ${p.label} preset's own length)` : ''));
    console.log(`  folder   : ${dir}`);

    if (DRY) {
        // Show both prompts with a stand-in cast, so the whole pipeline is
        // inspectable without a key and without spending anything. When the run
        // uses the standing cast there is nothing to stand in for - these ARE
        // the characters the run will use, so they are shown as they are.
        const fake = houseCast.length ? houseCast : [
            { name: 'Mira', description: 'Same Mira throughout - (the real cast is written at run time)' },
            { name: 'Tomas', description: 'Same Tomas throughout - (the real cast is written at run time)' },
        ];
        const fakeOutline = Array.from({ length: SCENES }, (_, i) => ({
            title: `Beat ${i + 1}`, beat: '(the real beat is written at run time)',
        }));
        const cut = Math.min(BATCH, SCENES);
        console.log('\n--dry-run: prompts only, nothing sent and nothing written.');
        console.log(houseCast.length
            ? `  The cast below is the standing cast the run will actually use, read from\n` +
              `  ${CAST_FILE ? path.resolve(CAST_FILE) : HOUSE_CAST_FILE}.\n`
            : '  The cast below is a stand-in; at run time call 1 writes the real one\n' +
              '  and call 2 is handed it.');
        console.log('\n' + '='.repeat(72) + '\nCALL 1 of 2 - cast and outline\n' + '='.repeat(72));
        console.log(castPrompt(p, houseCast));
        console.log('\n' + '='.repeat(72) + `\nCALL 2 of 2 - clips 1-${cut} of ${SCENES}` +
                    (SCENES > cut ? ' (then repeated for each further batch)' : '') +
                    '\n' + '='.repeat(72));
        console.log(scenesPrompt(p, fake, fakeOutline, 0, cut, []));
        return;
    }

    if (!ring.size) {
        console.error('\nNo API key. Pass --key, or set GEMINI_API_KEY, or put');
        console.error('"gemini_api_keys" in gui_settings.json (which is gitignored).');
        process.exit(1);
    }
    if (ring.size > 1) {
        console.log(`  keys     : ${ring.size} configured, used in order - ` +
                    `${ring.keys.map(maskKey).join(', ')}`);
    }
    console.log(`  models   : ${MODELS.join(' -> ')}`);

    if (fs.existsSync(dir) && !FORCE) {
        const existing = fs.readdirSync(dir).filter(f => f.endsWith('_story.json'));
        if (existing.length) {
            console.error(`\n${dir} already holds ${existing.join(', ')}.`);
            console.error('Refusing to overwrite a story. Use --force, or --out elsewhere.');
            process.exit(1);
        }
    }

    try {
        // 1. cast + outline
        process.stdout.write('\n  [1/2] writing the cast and outline ... ');
        const meta = await ask(ring, MODELS, castPrompt(p, houseCast), 8192);
        // The standing cast is not the model's to design: those faces are
        // attached after this call and are never re-described. Whatever it DID
        // design is additive - the person a standing character is talking to, in
        // a genre that cannot be carried alone - so the film's cast is the two
        // together. A name it echoes back is dropped rather than duplicated, or
        // the same woman would be described twice and drift against herself.
        const designed = normaliseCast(p, meta.characters || []).filter(c => !houseCast.some(
            h => String(h.name).toLowerCase() === String(c.name).toLowerCase()));
        const cast = [...houseCast, ...designed];
        const outline = meta.outline || [];
        // Only a preset that declares `cast: "required"` is allowed to fail
        // here. For an optional-cast genre an empty list is an ANSWER - the
        // model judged the topic needs no character - not a generation error.
        if (!cast.length && p.cast !== 'optional') {
            throw new Error('the model returned no characters, but this preset requires a cast');
        }
        if (outline.length !== SCENES) {
            console.log(`\n  note: asked for ${SCENES} beats, got ${outline.length}. Using what came back.`);
        }
        console.log(`ok - ${cast.length
            ? cast.map(c => c.name).join(', ') + (houseCast.length ? ' (the standing cast plus who the story needed)' : '')
            : 'no cast (this topic needs none)'}, ${outline.length} beats`);

        // 2. scenes, in batches that each fit comfortably in one response
        const scenes = [];
        const total = outline.length;
        // The one place, from the preset or from call 1. Every batch is told the
        // same one, which is what a batch cannot work out for itself: the
        // batches share no state, so left to themselves each would pick its own.
        // A preset with no place of its own takes call 1's choice; the preset's
        // own place, if it ever had one, would win instead. The expression matches
        // buildStory's, or call 2 would be locked to one place while the story
        // recorded another.
        const metaPlace = String((meta && meta.place_description) || '').trim();
        const useMetaPlace = !!metaPlace && !p.setting;
        const place = String(useMetaPlace ? metaPlace : (p.setting || '')).trim();
        for (let from = 0; from < total; from += BATCH) {
            const to = Math.min(from + BATCH, total);
            process.stdout.write(`  [2/2] clips ${from + 1}-${to} of ${total} ... `);
            const r = await ask(ring, MODELS, scenesPrompt(p, cast, outline, from, to, scenes, place), 16384);
            const got = r.scenes || [];
            if (!got.length) throw new Error(`clip batch ${from + 1}-${to} came back empty`);
            scenes.push(...got);
            console.log(`ok (${got.length})`);
        }

        const story = buildStory(p, cast, meta, scenes);

        const bad = validate(story, cast, p);
        if (bad.length) {
            console.error('\n  REFUSING TO WRITE. The generated story failed validation:');
            for (const b of bad) console.error(`    - ${b}`);
            console.error('\n  Nothing was written. Re-run, or write the story by hand and');
            console.error('  use `npm run agent:prompt` on it.');
            process.exit(1);
        }

        const storyPath = writePackage(dir, p, story, cast);

        console.log(`\n  wrote  ${storyPath}`);
        console.log(`  wrote  ${path.join(dir, 'style_bible.md')}`);
        const hasPlace = !!(story.place && story.place.description);
        const placeLabel = hasPlace ? (story.place.name || 'the place') : '';
        // A standing cast has nothing to draw, so the closing lines are about the
        // one image this story still needs - the place plate - and then about the
        // sheets stage 2 fetches from house_refs/ by itself.
        const drawn = cast.filter(c => !c.reference);
        const standing = cast.filter(c => c.reference);
        const standingWho = standing.map(c => '@' + c.name).join(' and ');
        if (drawn.length || hasPlace) {
            console.log(`  wrote  ${path.join(dir, 'character_sheets.txt')}`);
        }
        if (drawn.length) {
            console.log(`\n  next   : generate the reference sheets${hasPlace ? ' and the place plate' : ''}`);
            console.log(`           from character_sheets.txt into character_refs/. Do not make`);
            console.log('           Flow Characters - stage 2 uploads each one as a plain image');
            console.log(`           and @-mentions it${hasPlace ? `, including @${placeLabel}` : ''}.`);
        } else if (standing.length) {
            console.log(`\n  next   : nothing to draw for the cast - ${standingWho} ` +
                        `${standing.length > 1 ? 'are' : 'is'} the`);
            console.log('           standing cast and their sheets are already in house_refs/.');
            if (hasPlace) {
                console.log('           Generate the place plate from character_sheets.txt into');
                console.log('           character_refs/. Stage 2 then uploads the cast sheets from');
                console.log(`           house_refs/ and @-mentions ${standingWho} and @${placeLabel}.`);
            } else {
                console.log('           Stage 2 uploads them from there and @-mentions ' + standingWho + '.');
            }
        } else if (hasPlace) {
            console.log(`\n  next   : generate the place plate from character_sheets.txt into`);
            console.log(`           character_refs/, then continue - stage 2 @-mentions it as`);
            console.log(`           @${placeLabel} in every clip.`);
        } else {
            console.log('\n  no character sheets - this topic needs no cast.');
            console.log('  next   : nothing to upload into Flow, so go straight to stage 1.');
        }
        console.log(`           npm run agent:prompt -- ${path.relative(HERE, storyPath)}`);
        console.log('');
    } catch (e) {
        console.error(`\n  FAILED: ${e.message}`);
        if (isQuotaError(e)) {
            console.error(`  Every one of the ${ring.size} configured key(s) is out of quota.`);
            console.error('  Add another key on the Script tab, or wait for the quota to reset.');
        } else if (e.status === 404 || /not found|not supported/i.test(e.message)) {
            console.error(`  The model "${MODEL}" was not usable with this key. Available:`);
            try {
                for (const m of await listModels(ring.current)) console.error('    ' + m);
            } catch (e2) { console.error('    (could not list them either: ' + e2.message + ')'); }
            console.error('  Pass one of those with --model.');
        }
        process.exit(1);
    }
})();

module.exports = {
    slugify, buildStory, validate, writePackage, loadPreset,
    castPrompt, scenesPrompt, parseJson, geminiText,
    apiKeys, maskKey, isQuotaError, isKeyRejected, isTransient, isParseError, isModelError, KeyRing, ask, callApi,
    normaliseCast, usePresetDuration, lookBlock, sanitizeForPolicy,
    loadHouseCast, houseCastApplies, HOUSE_CAST_FILE, HOUSE_REFS_DIR,
    contentMapBlock, contentMapClips,
    presetLists, GENAI_STYLES_FILE,
    DEFAULT_MODELS, MODELS, MODEL,
};
