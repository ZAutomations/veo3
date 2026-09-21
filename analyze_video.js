#!/usr/bin/env node
/**
 * ANALYSE A REFERENCE VIDEO  ->  a style brief AND a content map
 * =============================================================
 * Give this a public YouTube URL. Gemini watches it (frames + audio) and returns
 * two things a story can be built from:
 *
 *   1. a style/format brief - medium, palette, lighting, camera language,
 *      narration tone, and the beat structure. This is what a creator would
 *      otherwise type by hand into the GUI's Story Details box.
 *   2. a CONTENT MAP - the real places named or shown, at what time, and the one
 *      point made in each ~CLIP_SECONDS slice, one segment per future clip. This
 *      is the part that stops the story writer inventing its own structure: the
 *      beats follow the reference's places and order instead of free-associating.
 *
 * WHAT IT DOES NOT DO: copy the video. It extracts FORMAT and FACTS. The prompt
 * forbids reproducing the narrator's sentences, real people, channels or brands.
 * Facts are reusable; a script is not.
 *
 * Usage:
 *   node analyze_video.js https://www.youtube.com/shorts/XXXXXXXX
 *   node analyze_video.js <url> --preset geography-map --seconds 8
 *   node analyze_video.js <url> --out stories/_reference --json
 *
 * Outputs, into --out (default stories/_reference/):
 *   <slug>.detail.txt        the style brief + the beats, ready for --detail-file
 *   <slug>.content-map.json  the full structured result, ready for --content-map
 *
 * Needs a Gemini key, same sources as write_story.js: --key, GEMINI_API_KEY, or
 * gui_settings.json.
 */

const fs = require('fs');
const path = require('path');
// Reuse the key ring, the API caller and the JSON parser rather than growing a
// second copy of them. write_story.js is import-safe (its main is behind
// require.main).
const W = require('./write_story.js');

const HERE = __dirname;
const STYLES_FILE = path.join(HERE, 'styles.json');

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

const URL = argv.find((a) => !a.startsWith('--')) || '';
const PRESET = typeof flag('--preset') === 'string' ? flag('--preset').trim() : '';
const SECONDS = num('--seconds', 8);
const CLIPS = num('--clips', 0);
const MODEL_FLAG = typeof flag('--model') === 'string' ? flag('--model') : '';
// Same fallback chain as write_story.js: newest flash first, then the next, so a
// busy or unavailable model does not sink the analysis.
const MODELS = (MODEL_FLAG || W.DEFAULT_MODELS).split(',').map((s) => s.trim()).filter(Boolean);
const MODEL = MODELS[0];
const OUT = typeof flag('--out') === 'string'
    ? path.resolve(HERE, flag('--out')) : path.join(HERE, 'stories', '_reference');
const JSON_ONLY = !!flag('--json', false);

function die(m) { console.error(m); process.exit(1); }

// ── the analysis prompt ------------------------------------------------------
function buildPrompt() {
    let ids = [];
    try {
        // Both preset lists, so the analyser can suggest a GENAI preset too.
        ids = W.presetLists().map((p) => `${p.id} - ${p.label}`);
    } catch (e) { /* the suggestion is optional anyway */ }
    const presetLine = PRESET ? `The creator wants the preset "${PRESET}" unless it is a poor fit.` : '';
    const clipsLine = CLIPS > 0
        ? `Produce AT LEAST ${CLIPS} clips. Spread the facts out, one or two per clip, rather than cramming them.`
        : 'The number of clips is decided by COVERAGE: as many as it takes. Do not shorten the film to fit a round number.';
    return `You are analysing a short-form video so a production pipeline can make a NEW,
ORIGINAL film that covers THE SAME FACTS, in the same order, with NEW wording.
You extract the shape and the facts, never the script.

CRITICAL - THESE VIDEOS ARE FAST. They often name MANY countries or places in a
few seconds, one per second. Be EXHAUSTIVE. Do not merge two different countries
into one entry, and do not skip a quick mention. If the video names ten places,
there are TEN facts. Missing one is the failure mode this prompt exists to stop.

Reply with ONE JSON object and nothing else:

{
  "title_suggestion": "a fresh title of your own, in the same genre",
  "preset_suggestion": "<the single best id from the list below>",
  "format": {
    "source_duration_s": <the video's real length in seconds>,
    "clip_seconds": ${SECONDS},
    "narration": <true or false>,
    "on_screen_text": <true or false>,
    "medium": "a few words, e.g. 3D satellite map, stylised 3D explainer"
  },
  "style": "one paragraph: medium, rendering, palette, lighting, camera language. Name no studio, channel, brand, artist, flag or real person.",
  "narration": "voice tone and pace, or null if there is none",
  "never_change": "what stays identical across the whole video",
  "facts": [
    {
      "t": "M:SS",
      "places": ["EVERY place named or shown at this moment"],
      "detail": "the one specific fact about it, in your own words"
    }
  ],
  "clips": [
    {
      "index": 1,
      "t_start": "M:SS",
      "t_end": "M:SS",
      "places": ["the places this clip covers"],
      "points": ["one line per fact covered in this clip, in your own words"],
      "visual": "what the map or shot does here: camera move, highlight, zoom"
    }
  ],
  "coverage": "one sentence confirming every fact above appears in exactly one clip",
  "notes": "anything uncertain - a place name you are guessing, a timing that overlaps"
}

RULES
- "facts" is the GROUND TRUTH and must be exhaustive: one entry per distinct
  place or fact, each with its timestamp. This list is longer than the clip list
  whenever several places share a clip.
- "clips" groups those facts into clips of about ${SECONDS} seconds. A clip may hold
  one to three related facts. ${clipsLine} NEVER drop a fact to make the film shorter.
- "detail" and "points" MUST be in your own words. Never reproduce the narrator's
  sentences. Reuse the facts; rewrite every line.
- Use the REAL place names, spelled as they are said or shown. Flag a guessed name
  in "notes".
- No real people, channels, brands, studios, national flags or trademarks anywhere.
- If there is no map, describe the place, body or environment instead.

PRESETS (choose the best id):
${ids.map((x) => '  ' + x).join('\n')}

${presetLine}`.trim();
}

// ── the call ----------------------------------------------------------------
// ask() in write_story.js is text-only, so the video part is added here, but the
// key rotation, retries and parsing are the same ones it uses.
async function askVideo(ring, promptText) {
    // Two tries per model when there is a chain to fall back on, else more.
    const tries = MODELS.length > 1 ? 2 : 5;
    for (let mi = 0; mi < MODELS.length; mi++) {
        const model = MODELS[mi];
        let attempt = 0;
        for (;;) {
            const key = ring.current;
            try {
                const resp = await W.callApi(key, model, {
                    contents: [{
                        parts: [
                            { text: promptText },
                            { file_data: { file_uri: URL } },
                        ],
                    }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        temperature: 0.4,
                        maxOutputTokens: 8192,
                    },
                });
                return W.parseJson(W.geminiText(resp));
            } catch (e) {
                if (W.isQuotaError(e) || W.isKeyRejected(e)) {
                    if (!ring.retire()) throw e;
                    const why = W.isKeyRejected(e) ? 'was rejected' : 'is out of quota';
                    console.log(`  ${W.maskKey(key)} ${why} - switching to ${ring.label}`);
                    attempt = 0;
                    continue;
                }
                if (W.isTransient(e) || W.isParseError(e)) {
                    if (attempt < tries) {
                        attempt++;
                        await new Promise((r) => setTimeout(r, attempt * 5000));
                        continue;
                    }
                    if (mi < MODELS.length - 1) {
                        console.log(`  ${model} is still failing - falling back to ${MODELS[mi + 1]}`);
                        break;
                    }
                    throw e;
                }
                if (W.isModelError(e) && mi < MODELS.length - 1) {
                    console.log(`  ${model} is not usable with this key - falling back to ${MODELS[mi + 1]}`);
                    break;
                }
                throw e;
            }
        }
    }
    throw new Error('every model in the chain failed');
}

// ── shaping the result -------------------------------------------------------
// Exported so the test can cover it without touching the network.
// The clip plan is `clips`; `segments` is the older name, still accepted.
function clipItems(cm) {
    if (Array.isArray(cm && cm.clips) && cm.clips.length) return cm.clips;
    if (Array.isArray(cm && cm.segments)) return cm.segments;
    return [];
}

function buildDetail(cm) {
    const f = (cm && cm.format) || {};
    const items = clipItems(cm);
    const facts = Array.isArray(cm && cm.facts) ? cm.facts : [];
    const beats = items.map((s, i) => {
        const places = Array.isArray(s.places) ? s.places.join(', ') : (s.places || '');
        const point = s.point || (Array.isArray(s.points) ? s.points.join('; ') : (s.points || ''));
        const vis = s.visual ? ` (visual: ${s.visual})` : '';
        return `${i + 1}. ${places ? places + ' - ' : ''}${point}${vis}`;
    }).join('\n');
    // The exhaustive fact list is printed too, so a long list of countries is
    // not silently reduced to the clips' summaries.
    const factBlock = facts.length
        ? ['EVERY FACT (each one must appear somewhere, in your own words):',
            ...facts.map((x) => `  - ${(Array.isArray(x.places) ? x.places.join(', ') : (x.places || ''))}` +
                `${x.t ? ` [${x.t}]` : ''}: ${x.detail || ''}`)]
        : [];
    return [
        `Genre: ${f.medium || 'short-form'} explainer.`,
        `Aesthetic: ${cm.style || ''}`,
        `Format: ${items.length || '?'} clips of ${f.clip_seconds || SECONDS}s, ` +
            (f.narration === false ? 'no narration' : 'narrated voice-over') + '.',
        `Narration: ${cm.narration || 'a calm, measured narrator'}`,
        `Never change: ${cm.never_change || 'the same medium, palette, lighting and camera language for the whole film.'}`,
        'Beats:',
        beats,
        ...factBlock,
    ].join('\n');
}

function slugOf(s) { return W.slugify(s || 'reference_video'); }

if (require.main === module) (async () => {
    const die2 = (m) => { console.error(m); process.exit(1); };
    if (!URL) {
        console.error('Usage: node analyze_video.js <youtube-url> [--preset id] [--seconds 8] [--model m] [--out DIR] [--json] [--key K]');
        process.exit(1);
    }
    if (!/^https?:\/\//i.test(URL)) die2(`Not a URL: ${URL}`);
    if (!fs.existsSync(STYLES_FILE)) die2('styles.json not found next to analyze_video.js');

    const keys = W.apiKeys();
    if (!keys.length) {
        die2('No Gemini key. Add one on the GUI Script tab, set GEMINI_API_KEY, or pass --key.');
    }
    const ring = new W.KeyRing(keys);
    console.log(`Analysing ${URL}\n  ${ring.label}, models ${MODELS.join(' -> ')}, ${SECONDS}s per clip`);
    console.log('  (Gemini reads the video; this can take a little while.)');

    let cm;
    try {
        cm = await askVideo(ring, buildPrompt());
    } catch (e) {
        die2(`Video analysis failed: ${e.message}`);
    }

    const title = String(cm.title_suggestion || 'Reference video').trim();
    // Remember which link produced this map, so a later batch can find the story
    // it already wrote instead of analysing the same video again.
    cm.source_url = URL;
    const slug = slugOf(title);
    fs.mkdirSync(OUT, { recursive: true });
    const detailPath = path.join(OUT, `${slug}.detail.txt`);
    const mapPath = path.join(OUT, `${slug}.content-map.json`);
    const detail = buildDetail(cm);
    fs.writeFileSync(detailPath, detail + '\n', 'utf8');
    fs.writeFileSync(mapPath, JSON.stringify(cm, null, 2) + '\n', 'utf8');

    if (JSON_ONLY) {
        console.log(JSON.stringify(cm, null, 2));
    } else {
        console.log('\n' + detail + '\n');
    }
    console.log(`  suggested title : ${title}`);
    console.log(`  suggested preset: ${cm.preset_suggestion || '(none)'}`);
    console.log(`  clips           : ${clipItems(cm).length}   (${(cm.facts || []).length} facts)`);
    if (cm.notes) console.log(`  notes           : ${cm.notes}`);
    console.log(`\ndetail      : ${detailPath}`);
    console.log(`content_map : ${mapPath}`);
})().catch((e) => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });

module.exports = { buildDetail, buildPrompt, slugOf, clipItems };
