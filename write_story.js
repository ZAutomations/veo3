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
const DURATION = num('--duration', 56);
const SECONDS = num('--seconds', 8);
const ASPECT = typeof flag('--aspect') === 'string' ? flag('--aspect').trim() : '16:9';
const MODEL = typeof flag('--model') === 'string' ? flag('--model') : 'gemini-2.5-flash';
const BATCH = num('--scenes-per-call', 6);
const DRY = !!flag('--dry-run', false);
const FORCE = !!flag('--force', false);
const OUT_DIR = typeof flag('--out') === 'string' ? flag('--out') : null;
const LIST_MODELS = !!flag('--list-models', false);

// ── api key ------------------------------------------------------------------
// Never printed. A key on a command line also lands in the shell history, which
// is why the env var and the settings file are checked first in practice.
function apiKey() {
    const fromFlag = flag('--key');
    if (typeof fromFlag === 'string' && fromFlag.trim()) return fromFlag.trim();
    for (const v of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY']) {
        if (process.env[v] && process.env[v].trim()) return process.env[v].trim();
    }
    try {
        const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        for (const k of ['gemini_api_key', 'gemini_key', 'GEMINI_API_KEY']) {
            if (typeof s[k] === 'string' && s[k].trim()) return s[k].trim();
        }
    } catch (e) { /* no settings file yet - fine */ }
    return null;
}

async function callApi(key, model, body) {
    const url = `${API}/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
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

async function ask(key, model, prompt, maxTokens) {
    const resp = await callApi(key, model, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.9,
            maxOutputTokens: maxTokens,
        },
    });
    return parseJson(geminiText(resp));
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
const SCENES = Math.max(1, Math.round(DURATION / SECONDS));
// Narration has to finish inside the clip. The Bridge story runs 15-23 words per
// 8s scene, which is ordinary narration pace; 26 is the hard stop so a scene
// never has to be rushed or cut off mid-sentence.
const WORDS_MAX = 24;
const WORDS_HARD = 28;
const mmss = (n) => `${Math.floor((n * SECONDS) / 60)}:${String((n * SECONDS) % 60).padStart(2, '0')}`;

function lookBlock(p) {
    return [
        `LOOK: ${p.style}`,
        `CAST TEMPLATE (every character description must follow this shape): ${p.cast_idiom}`,
        `PALETTE: ${p.palette}`,
        `CAMERA: ${p.camera}`,
        `NARRATOR: ${p.narration_voice}`,
        `NEVER: ${p.avoid}`,
    ].join('\n');
}

function castPrompt(p) {
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
4. Design the cast. Use 2 or 3 characters at most; a small cast stays consistent.
   For EACH character give:
     "name"        - one word, capitalised, no spaces (e.g. "Mira")
     "description" - 55 to 75 words, STARTING with "Same <name> throughout - " and
                     following the CAST TEMPLATE exactly. State age, build,
                     clothing, hair, face, and the rendering medium. End with the
                     NEVER guard restated as "NOT ..." so the model cannot drift.
                     Every character must be described in the SAME medium.
     "sheet_prompt" - a 30 to 45 word prompt for an image generator to make that
                     character's reference sheet: full body, neutral pose, plain
                     background, consistent lighting. Include the medium.
5. Write an "outline": exactly ${SCENES} entries, one per clip.
     "title" - 2 to 5 words
     "beat"  - one sentence: what happens in this clip and what changes.
   The ${SCENES} beats must form ONE story with a turn and an ending, not a list
   of nice moments. Draw on these shapes that suit this look:
${(p.story_shapes || []).map(s => `     - ${s}`).join('\n')}

Return ONLY this JSON, no other text:
{"description":"","moral":"","target_audience":"","characters":[{"name":"","description":"","sheet_prompt":""}],"outline":[{"title":"","beat":""}]}`;
}

function scenesPrompt(p, cast, outline, from, to, soFar) {
    const castText = cast.map(c =>
        `  ${c.name}: ${c.description}`).join('\n');
    const beats = outline.slice(from, to).map((o, i) =>
        `  Clip ${from + i + 1} - "${o.title}": ${o.beat}`).join('\n');
    const prev = soFar.length
        ? `\nTHE PREVIOUS CLIP ENDED LIKE THIS (continue from it, do not repeat it):\n  "${soFar[soFar.length - 1].script_line}"\n`
        : '';

    return `You are writing clips ${from + 1} to ${to} of a ${SCENES}-clip ${p.label} video.

TITLE: ${TITLE}
DETAIL FROM THE CREATOR: ${DETAIL || '(none given)'}
${lookBlock(p)}

THE CAST - do not change, rename or redesign anyone:
${castText}
${prev}
THE BEATS FOR THESE CLIPS (one clip each, same order):
${beats}

For EACH clip above, in order, return:
  "scene_title"       - the beat's title
  "script_line"       - the NARRATION, spoken by the narrator. ONE sentence,
                        ${WORDS_MAX} words or fewer, hard limit ${WORDS_HARD}. It is read
                        verbatim as voice-over, so it must sound natural spoken
                        aloud and must fit inside ${SECONDS} seconds. Present tense.
  "narrative_context" - 80 to 130 words describing what is ON SCREEN: the setting,
                        who is present, what they do, the light, the mood, and the
                        camera. Describe the action and the emotion. Do NOT name a
                        rendering medium, a studio or an art style - the look is
                        already fixed above and naming it again is what makes
                        scenes drift apart.
  "characters"        - array of the cast names actually VISIBLE in this clip.
                        Only who is on screen. Never list an absent character:
                        naming someone who is not there invites the model to
                        insert them.

Write exactly ${to - from} clips. Return ONLY this JSON, no other text:
{"scenes":[{"scene_title":"","script_line":"","narrative_context":"","characters":[]}]}`;
}

// ── assemble + validate ------------------------------------------------------
function buildStory(p, cast, meta, scenes) {
    const descriptions = {}, references = {};
    for (const c of cast) {
        const key = c.name.toLowerCase();
        descriptions[key] = c.description;
        references[key] = `./character_refs/${key}_reference_sheet.jpg`;
    }
    const total = scenes.length * SECONDS;
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
        narrated: true,
        silent_cast: true,
        narrator_voice: p.narration_voice,
        scenes: scenes.map((s, i) => ({
            _scene_number: i + 1,
            _scene_title: s.scene_title,
            _timing: `${mmss(i)}-${mmss(i + 1)}`,
            scene_builder_action: 'text_to_video',
            extend_from_last_frame: false,
            script_line: s.script_line,
            narrative_context: s.narrative_context,
            veo3_prompt: `[SHOT] ${s.narrative_context}\n[LOOK] ${p.style}\n[AUDIO] Narrator (V.O., ${p.narration_voice}): "${s.script_line}"`,
            characters: (s.characters || []).map(x => String(x).toLowerCase()),
        })),
        character_descriptions: descriptions,
        character_references: references,
    };
}

function validate(story, cast) {
    const bad = [];
    const names = cast.map(c => c.name.toLowerCase());
    if (!story.description) bad.push('description is empty');
    if (!story.moral) bad.push('moral is empty');
    if (!story.scenes.length) bad.push('no scenes');
    story.scenes.forEach((s, i) => {
        const n = i + 1;
        if (!String(s.script_line || '').trim()) {
            bad.push(`clip ${n}: no script_line - the agent would INVENT this scene`);
        } else {
            const w = s.script_line.trim().split(/\s+/).length;
            if (w > WORDS_HARD) bad.push(`clip ${n}: narration is ${w} words, over the ${WORDS_HARD}-word limit for ${SECONDS}s`);
        }
        if (!String(s.narrative_context || '').trim()) bad.push(`clip ${n}: no narrative_context`);
        if (!s.characters.length) bad.push(`clip ${n}: no characters listed`);
        s.characters.forEach(c => {
            if (!names.includes(c)) bad.push(`clip ${n}: "${c}" is not in the cast (${names.join(', ')})`);
        });
    });
    return bad;
}

// ── writers ------------------------------------------------------------------
function writePackage(dir, p, story, cast) {
    const slug = path.basename(dir);
    fs.mkdirSync(path.join(dir, 'character_refs'), { recursive: true });

    // Story JSON. LF and a trailing newline, like styles.json. (`cast` is passed
    // in rather than hung off `story` as a _cast key, so it cannot leak into the
    // written file - the schema has no such field and stage 1 would carry it.)
    const storyPath = path.join(dir, `${slug}_story.json`);
    fs.writeFileSync(storyPath, JSON.stringify(story, null, 2) + '\n', 'utf8');

    const sheets = Object.entries(story.character_descriptions).map(([k, desc]) => {
        const c = cast.find(x => x.name.toLowerCase() === k) || {};
        return [
            `=== ${k.toUpperCase()} ===`,
            `save as: character_refs/${k}_reference_sheet.jpg`,
            '',
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
        `Every sheet must be made with the same medium or the cast will not match.\n\n` +
        sheets + '\n', 'utf8');

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
        '## Narrator',
        p.narration_voice,
        '',
        '## Never',
        p.avoid,
        '',
        '## Story shapes that suit this look',
        ...(p.story_shapes || []).map(s => `- ${s}`),
        '',
        '## Cast',
        ...Object.entries(story.character_descriptions).map(([k, v]) => `**${k}** - ${v}`),
        '',
        '## What happens next',
        '1. Generate the sheets from `character_sheets.txt` (Whisk or any image tool).',
        '2. Upload each into Flow as a Character, named exactly as above.',
        '3. Stage 1: `npm run agent:prompt -- stories/' + slug + '/' + slug + '_story.json`',
        '4. Then the usual stages 2-4.',
        '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'style_bible.md'), bible, 'utf8');

    return storyPath;
}

// ── main ---------------------------------------------------------------------
// Guarded so the internals can be required by a test. Everything above is pure -
// build a story, validate it, write it - and only this block touches the network.
if (require.main === module) (async () => {
    const key = apiKey();

    if (LIST_MODELS) {
        if (!key) { console.error('No API key. Set GEMINI_API_KEY or pass --key.'); process.exit(1); }
        try {
            for (const m of await listModels(key)) console.log('  ' + m);
        } catch (e) { console.error('Could not list models:', e.message); process.exit(1); }
        return;
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
    const slug = slugify(TITLE);
    const dir = OUT_DIR || path.join(STORIES_DIR, slug);

    console.log(`\n  title    : ${TITLE}`);
    console.log(`  preset   : ${p.label}  [${p.id}]`);
    console.log(`  format   : ${ASPECT}, ${SECONDS}s per clip`);
    console.log(`  duration : ${DURATION}s  ->  ${SCENES} clips`);
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

    if (!key) {
        console.error('\nNo API key. Pass --key, or set GEMINI_API_KEY, or put');
        console.error('"gemini_api_key" in gui_settings.json (which is gitignored).');
        process.exit(1);
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
        const meta = await ask(key, MODEL, castPrompt(p), 8192);
        const cast = meta.characters || [];
        const outline = meta.outline || [];
        if (!cast.length) throw new Error('the model returned no characters');
        if (outline.length !== SCENES) {
            console.log(`\n  note: asked for ${SCENES} beats, got ${outline.length}. Using what came back.`);
        }
        console.log(`ok - ${cast.map(c => c.name).join(', ')}, ${outline.length} beats`);

        // 2. scenes, in batches that each fit comfortably in one response
        const scenes = [];
        const total = outline.length;
        for (let from = 0; from < total; from += BATCH) {
            const to = Math.min(from + BATCH, total);
            process.stdout.write(`  [2/2] clips ${from + 1}-${to} of ${total} ... `);
            const r = await ask(key, MODEL, scenesPrompt(p, cast, outline, from, to, scenes), 16384);
            const got = r.scenes || [];
            if (!got.length) throw new Error(`clip batch ${from + 1}-${to} came back empty`);
            scenes.push(...got);
            console.log(`ok (${got.length})`);
        }

        const story = buildStory(p, cast, meta, scenes);

        const bad = validate(story, cast);
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
        console.log(`  wrote  ${path.join(dir, 'character_sheets.txt')}`);
        console.log(`\n  next   : generate the reference sheets from character_sheets.txt,`);
        console.log('           upload them into Flow as Characters, then run stage 1.');
        console.log(`           npm run agent:prompt -- ${path.relative(HERE, storyPath)}`);
        console.log('');
    } catch (e) {
        console.error(`\n  FAILED: ${e.message}`);
        if (e.status === 404 || /not found|not supported/i.test(e.message)) {
            console.error(`  The model "${MODEL}" was not usable with this key. Available:`);
            try {
                for (const m of await listModels(key)) console.error('    ' + m);
            } catch (e2) { console.error('    (could not list them either: ' + e2.message + ')'); }
            console.error('  Pass one of those with --model.');
        }
        process.exit(1);
    }
})();

module.exports = {
    slugify, buildStory, validate, writePackage, loadPreset,
    castPrompt, scenesPrompt, parseJson, geminiText,
};
