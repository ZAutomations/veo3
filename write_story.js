#!/usr/bin/env node
/**
 * WRITE A STORY FROM A TITLE
 * ==========================
 * title + detail + duration + preset  ->  a whole story package on disk.
 *
 * WHAT IT PRODUCES
 *   stories/<slug>/<slug>_story.json     the story, in the schema stage 1 reads
 *   stories/<slug>/style_bible.md        the look, for you to read and keep
 *   stories/<slug>/character_sheets.txt  paste-ready Whisk prompts, one per character
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

const HERE = __dirname;
const STORIES_DIR = path.join(HERE, 'stories');
const STYLES_FILE = path.join(HERE, 'styles.json');
const SETTINGS_FILE = path.join(HERE, 'gui_settings.json');
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

const TITLE = typeof flag('--title') === 'string' ? flag('--title').trim() : '';
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
const PRESET_ID = typeof flag('--preset') === 'string' ? flag('--preset').trim() : '';
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
const MODEL = typeof flag('--model') === 'string' ? flag('--model') : 'gemini-3.6-flash';
const BATCH = num('--scenes-per-call', 6);
const DRY = !!flag('--dry-run', false);
const FORCE = !!flag('--force', false);
const OUT_DIR = typeof flag('--out') === 'string' ? flag('--out') : null;
const LIST_MODELS = !!flag('--list-models', false);

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
function parseJson(raw) {
    const t = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('no JSON object in the response');
    return JSON.parse(t.slice(a, b + 1));
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const RETRIES = num('--retries', 3);

// One call, with key rotation on quota errors only. A 404 (dead model) or a
// malformed request would fail identically on every key, so those are raised
// straight away instead of burning the whole ring proving it.
async function ask(ring, model, prompt, maxTokens) {
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
            if (isQuotaError(e)) {
                if (!ring.retire()) throw e;
                console.log(`\n  ${maskKey(key)} is out of quota - switching to ${ring.label}`);
                attempt = 0;   // a fresh key deserves a fresh set of retries
                continue;
            }
            if (isTransient(e) && attempt < RETRIES) {
                attempt++;
                const wait = attempt * 5000;
                console.log(`\n  ${e.status || 'network'} from the API - retrying in ` +
                            `${wait / 1000}s (${attempt}/${RETRIES})`);
                await sleep(wait);
                continue;
            }
            throw e;
        }
    }
}

// ── preset -------------------------------------------------------------------
function loadPreset(id) {
    const db = JSON.parse(fs.readFileSync(STYLES_FILE, 'utf8'));
    const list = db.styles || [];
    const s = list.find(x => x.id === id);
    if (!s) {
        console.error(`Unknown preset id: ${id || '(none given)'}`);
        console.error(`Known ids: ${list.map(x => x.id).join(', ')}`);
        process.exit(1);
    }
    return s;
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
let SCENES = Math.max(1, Math.round(DURATION / SECONDS));
function usePresetDuration(p) {
    if (DURATION_FLAG || !p.default_duration) return false;
    DURATION = p.default_duration;
    SCENES = Math.max(1, Math.round(DURATION / SECONDS));
    return true;
}
// Narration has to finish inside the clip. The Bridge story runs 15-23 words per
// 8s scene, which is ordinary narration pace; 26 is the hard stop so a scene
// never has to be rushed or cut off mid-sentence.
const WORDS_MAX = 24;
const WORDS_HARD = 28;
// Spoken dialogue is a different budget: it is exchanged rather than read, so the
// clip has to hold two or three short turns plus the pause between them, and
// speech with interruptions carries fewer words per second than narration.
// Derived from SECONDS rather than fixed, so `--seconds 5` tightens the lines
// instead of silently overflowing them - which the narration budget above still
// does, and is the reason this one is not written the same way.
const D_WORDS_MAX = Math.max(6, Math.round(SECONDS * 3));
const D_WORDS_HARD = Math.max(8, Math.round(SECONDS * 3.75));
const mmss = (n) => `${Math.floor((n * SECONDS) / 60)}:${String((n * SECONDS) % 60).padStart(2, '0')}`;

function lookBlock(p) {
    // `narration_scope: "dialogue"` is the fourth way a video can carry sound:
    // the characters speak on screen and nobody narrates. It is the inverse of
    // every other preset, whose whole rule set is "the visuals illustrate the
    // narration" - so the narrator line is replaced rather than added to.
    const dialogue = p.narration_scope === 'dialogue';
    // `narration_scope: "intro"` means the voice-over exists only over the
    // opening clip. Every other preset narrates throughout, so an absent field
    // leaves the line exactly as it always was.
    const intro = p.narration_scope === 'intro';
    return [
        `LOOK: ${p.style}`,
        `CAST TEMPLATE (every character description must follow this shape): ${p.cast_idiom}`,
        `PALETTE: ${p.palette}`,
        `CAMERA: ${p.camera}`,
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
        `NEVER: ${p.avoid}`,
    ].join('\n');
}

function castPrompt(p) {
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
    const castRule = optional
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
    const castFields = optional
        ? `     (only when the list is not empty)`
        : '';
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
    const sheetField = typed
        ? `     "sheet_prompt" - a 30 to 45 word prompt for an image generator to make that
                     character's ONE reference sheet. It must be a SINGLE image:
                     the video model takes at most 3 reference images, and a
                     multi-view sheet counts as more than one.
                       animal - full body, standing, three-quarter view, so the
                         face AND the coat markings are both readable in that one
                         image. Every physical marker must be visible in it.
                       human  - full body, neutral standing pose, facing camera.
                     Include the medium and consistent lighting.`
        : `     "sheet_prompt" - a 30 to 45 word prompt for an image generator to make that
                     character's reference sheet: full body, neutral standing
                     pose, consistent lighting. Include the medium.`;
    return `You are writing the character bible for a ${p.label} video.

TITLE: ${TITLE}
DETAIL FROM THE CREATOR: ${DETAIL || '(none given - infer a simple, specific story)'}
TOTAL LENGTH: ${DURATION} seconds across ${SCENES} clips of ${SECONDS} seconds.

${lookBlock(p)}

TASK
1. Write a one-sentence "description" of the whole video (max 30 words). It must
   describe WHAT HAPPENS, never what it looks like - the look is already fixed above.
2. Write a one-sentence "moral" (max 25 words).
3. Write "target_audience" (max 12 words).
${castRule}${castFields}
     "name"        - one word, capitalised, no spaces (e.g. "Mira")
${typeField}${descField}
${sheetField}
                     Every sheet in the cast must end with this exact background
                     phrase, word for word, with nothing added to it:
                     "plain neutral grey studio background"
                     Do not vary it per character - not "plain background", not
                     "plain gray background with a soft vignette". Sheets that
                     disagree on the background read as a different production.
5. Write an "outline": exactly ${SCENES} entries, one per clip.
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
   two says to the other, in one calm room. Write each beat as the turn it turns
   on - the hook that stops the viewer, a rule, the doubt that pushes back, the
   aphorism worth repeating, the resolution - not as a description of what is
   seen. A beat that is only a picture has nothing for anyone to say.` : ''}

Return ONLY this JSON, no other text:
{"description":"","moral":"","target_audience":"","characters":[{"name":"",${typed ? '"type":"",' : ''}"description":"","sheet_prompt":""}],"outline":[{"title":"","beat":""}]}`;
}

function scenesPrompt(p, cast, outline, from, to, soFar) {
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
                        aloud and must fit inside ${SECONDS} seconds. Present tense.`;
    const skeleton = dialogue
        ? `{"scenes":[{"scene_title":"","dialogue":[{"speaker":"","line":""}],"narrative_context":"","characters":[]}]}`
        : intro
        ? `{"scenes":[{"scene_title":"","script_line":"","sound_context":"","narrative_context":"","characters":[]}]}`
        : `{"scenes":[{"scene_title":"","script_line":"","narrative_context":"","characters":[]}]}`;

    return `You are writing clips ${from + 1} to ${to} of a ${SCENES}-clip ${p.label} video.

TITLE: ${TITLE}
DETAIL FROM THE CREATOR: ${DETAIL || '(none given)'}
${lookBlock(p)}
${audioBlock}
${castBlock}
${prev}
THE BEATS FOR THESE CLIPS (one clip each, same order):
${beatList}

For EACH clip above, in order, return:
${fields}
  "narrative_context" - 80 to 130 words describing what is ON SCREEN: the setting,
                        who is present, what they do, the light, the mood, and the
                        camera. Describe the action and the emotion. Do NOT name a
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

function buildStory(p, cast, meta, scenes) {
    const descriptions = {}, references = {};
    for (const c of cast) {
        const key = c.name.toLowerCase();
        descriptions[key] = c.description;
        references[key] = `./character_refs/${key}_reference_sheet.jpg`;
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
    return {
        title: TITLE,
        description: meta.description,
        total_scenes: scenes.length,
        video_duration: `${total} seconds`,
        target_audience: meta.target_audience || '',
        moral: meta.moral,
        niche: p.label,
        style: p.style,
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
            script_line: dialogue ? '' : s.script_line,
            // What is said in this clip, by whom. The whole film is this array.
            ...(dialogue ? { dialogue: speech(s) } : {}),
            // The sound brief only exists for sound-led presets. Naming the
            // literal sounds of the place is what stops a clip with no
            // voice-over from arriving with nothing on the audio track at all.
            ...(intro ? { sound_context: s.sound_context || '' } : {}),
            narrative_context: s.narrative_context,
            // A clip with no narration carries its sound brief in the AUDIO slot
            // instead of an empty narrator line, which the video model would
            // otherwise fill with invented dialogue. A dialogue clip carries the
            // lines themselves, attributed, so the model knows who says what.
            veo3_prompt: `[SHOT] ${s.narrative_context}\n[LOOK] ${p.style}\n[AUDIO] ` +
                (dialogue
                    ? (speech(s).length
                        ? speech(s).map(d => `${d.speaker} (on screen, speaking): "${d.line}"`).join('  ')
                        : 'No dialogue in this clip. Room tone and the ambient sound of the place only.')
                    : (intro && !String(s.script_line || '').trim())
                        ? `No voice-over in this clip. Natural sound only: ${s.sound_context}`
                        : `Narrator (V.O., ${p.narration_voice}): "${s.script_line}"`),
            characters: (s.characters || []).map(x => String(x).toLowerCase()),
        })),
        character_descriptions: descriptions,
        character_references: references,
    };
}

function validate(story, cast, p = {}) {
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

    if (cast.length) {
        const hasAnimal = cast.some(c => c.type === 'animal');
        const sheets = Object.entries(story.character_descriptions).map(([k, desc]) => {
            const c = cast.find(x => x.name.toLowerCase() === k) || {};
            return [
                `=== ${k.toUpperCase()} ===${c.type ? `   (${c.type})` : ''}`,
                `save as: character_refs/${k}_reference_sheet.jpg`,
                '',
                // An animal sheet has one job a human sheet does not: it has to
                // make the breed and the coat markings readable in a single
                // image, because those, not a face, are what the video model
                // reproduces from cut to cut.
                ...(c.type === 'animal'
                    ? ['This is an ANIMAL - one image only. Full body, standing,',
                       'three-quarter view, so the face AND the coat markings are',
                       'both readable. Every physical marker listed below must be',
                       'visible in it, or the video model will not reproduce them.',
                       '']
                    : []),
                '-- image prompt --',
                c.sheet_prompt || '(none generated - describe the character in the medium above)',
                '-- image prompt --',
                c.sheet_prompt || '(none generated - describe the character in the medium above)',
                '',
                '-- identity text (must match this exactly in the story JSON) --',
                desc,
            ].join('\n');
        }).join('\n\n');

        fs.writeFileSync(path.join(dir, 'character_sheets.txt'),
            `Character reference sheets for "${story.title}"\n` +
            `Generate each one, then upload it into Flow as a Character named exactly\n` +
            `${cast.map(c => c.name).join(', ')} (capital first letter).\n` +
            `Every sheet must be made with the same medium or the cast will not match.\n` +
            (hasAnimal
                ? 'One image per character. Do not make a multi-angle sheet for the\n' +
                  'animals - the video model accepts at most 3 reference images, and a\n' +
                  'multi-view sheet counts as more than one.\n'
                : '') +
            '\n' + sheets + '\n', 'utf8');
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
        ...(cast.length
            ? ['## Cast',
               ...Object.entries(story.character_descriptions).map(([k, v]) => `**${k}** - ${v}`),
               '',
               '## What happens next',
               '1. Generate the sheets from `character_sheets.txt` (Whisk or any image tool).',
               '2. Upload each into Flow as a Character, named exactly as above.',
               '3. Stage 1: `npm run agent:prompt -- stories/' + slug + '/' + slug + '_story.json`',
               '4. Then the usual stages 2-4.',
               '']
            : ['## Cast',
               'None. This topic is about the world rather than a person, so no',
               'character sheets were written and no Characters need to be uploaded',
               'into Flow before stage 1. Distant unnamed figures are scenery.',
               '',
               '## What happens next',
               '1. No reference sheets and no Characters to upload - skip straight to stage 1.',
               '2. Stage 1: `npm run agent:prompt -- stories/' + slug + '/' + slug + '_story.json`',
               '3. Then the usual stages 2-4.',
               '']),
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

    console.log(`\n  title    : ${TITLE}`);
    console.log(`  preset   : ${p.label}  [${p.id}]`);
    console.log(`  format   : ${ASPECT}, ${SECONDS}s per clip`);
    console.log(`  duration : ${DURATION}s  ->  ${SCENES} clips` +
                (fromPreset ? `  (the ${p.label} preset's own length)` : ''));
    console.log(`  folder   : ${dir}`);

    if (DRY) {
        // Show both prompts with a stand-in cast, so the whole pipeline is
        // inspectable without a key and without spending anything.
        const fake = [
            { name: 'Mira', description: 'Same Mira throughout - (the real cast is written at run time)' },
            { name: 'Tomas', description: 'Same Tomas throughout - (the real cast is written at run time)' },
        ];
        const fakeOutline = Array.from({ length: SCENES }, (_, i) => ({
            title: `Beat ${i + 1}`, beat: '(the real beat is written at run time)',
        }));
        const cut = Math.min(BATCH, SCENES);
        console.log('\n--dry-run: prompts only, nothing sent and nothing written.');
        console.log('  The cast below is a stand-in; at run time call 1 writes the real one\n' +
                    '  and call 2 is handed it.');
        console.log('\n' + '='.repeat(72) + '\nCALL 1 of 2 - cast and outline\n' + '='.repeat(72));
        console.log(castPrompt(p));
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
        const meta = await ask(ring, MODEL, castPrompt(p), 8192);
        const cast = normaliseCast(p, meta.characters || []);
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
            ? cast.map(c => c.name).join(', ')
            : 'no cast (this topic needs none)'}, ${outline.length} beats`);

        // 2. scenes, in batches that each fit comfortably in one response
        const scenes = [];
        const total = outline.length;
        for (let from = 0; from < total; from += BATCH) {
            const to = Math.min(from + BATCH, total);
            process.stdout.write(`  [2/2] clips ${from + 1}-${to} of ${total} ... `);
            const r = await ask(ring, MODEL, scenesPrompt(p, cast, outline, from, to, scenes), 16384);
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
        if (cast.length) {
            console.log(`  wrote  ${path.join(dir, 'character_sheets.txt')}`);
            console.log(`\n  next   : generate the reference sheets from character_sheets.txt,`);
            console.log('           upload them into Flow as Characters, then run stage 1.');
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
    apiKeys, maskKey, isQuotaError, isTransient, KeyRing, ask, callApi,
    normaliseCast, usePresetDuration, lookBlock,
};
