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
// The second transport: download the video and upload it, for when Google will
// not fetch the link itself. See the header of that file.
const V = require('./gemini_video_source.js');

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
const SOURCE_DURATION = num('--source-duration', 0);
const CLIPS = num('--clips', 0);
const MODEL_FLAG = typeof flag('--model') === 'string' ? flag('--model') : '';
// Same fallback chain as write_story.js: newest flash first, then the next, so a
// busy or unavailable model does not sink the analysis.
//
// A single pinned model is tried FIRST, not exclusively. "This model is
// currently experiencing high demand" is a PER-MODEL error, and the MCP batch
// passes exactly one model - so one model having a bad hour used to leave the
// whole analysis riding on that model's capacity, however many keys were in the
// ring. The caller's choice stays at the head of the chain, so the intent is
// kept and the other models become headroom behind it. A real chain
// (`--model a,b,c`) is still taken literally.
//
// Exported so the widening rule can be tested directly instead of inferred from
// a startup log line. `defaults` is the shared DEFAULT_MODELS string.
function modelChain(pinned, defaults) {
    const pin = String(pinned || '').split(',').map((s) => s.trim()).filter(Boolean);
    // An explicit chain is taken literally - the caller said which, in what order.
    if (String(pinned || '').includes(',')) return pin;
    const rest = String(defaults || '').split(',').map((s) => s.trim()).filter(Boolean);
    return [...new Set(pin.concat(rest))];
}

const MODELS = modelChain(MODEL_FLAG, W.DEFAULT_MODELS);
const MODEL = MODELS[0];
const OUT = typeof flag('--out') === 'string'
    ? path.resolve(HERE, flag('--out')) : path.join(HERE, 'stories', '_reference');
const JSON_ONLY = !!flag('--json', false);
// Holds the download + upload fallback off, for when the caller wants the native
// link to be the only path tried (or yt-dlp is not available).
const NO_DOWNLOAD = !!flag('--no-download', false);

function die(m) { console.error(m); process.exit(1); }

// ── the analysis prompt ------------------------------------------------------
function buildPrompt(presetId = PRESET) {
    let ids = [];
    try {
        // Both preset lists, so the analyser can suggest a GENAI preset too.
        ids = W.presetLists().map((p) => `${p.id} - ${p.label}`);
    } catch (e) { /* the suggestion is optional anyway */ }
    const selected = presetId ? W.loadPreset(presetId) : null;
    const preserveDialogue = !!(selected && selected.grounded_dialogue === true);
    const preserveNarration = !!selected?.preserve_source_narration;
    const presetInstructions = selected
        ? `SELECTED PRESET: ${selected.id} - ${selected.label}
Use this preset only. Set preset_suggestion to "${selected.id}". Do not compare,
search for, or substitute other presets.

SELECTED PRESET MASTER INSTRUCTIONS (the production tool's current preset):
${JSON.stringify(selected, null, 2)}

These instructions govern the NEW film's treatment. Keep the source facts,
timestamps and source-style observations faithful to the reference video;
do not claim the source has an effect merely because the selected preset asks
for it. Return the analysis JSON requested above, not the finished story yet.`
        : `PRESETS (choose the best id):\n${ids.map(x => '  ' + x).join('\n')}`;
    const clipsLine = SOURCE_DURATION > 0
        ? `The source is verified as ${SOURCE_DURATION} seconds. Use only timestamps within that source length. Do not stretch it to a production clip budget.` : CLIPS > 0
        ? `Produce AT LEAST ${CLIPS} clips. Spread the facts out, one or two per clip, rather than cramming them.`
        : 'The number of clips is decided by COVERAGE: as many as it takes. Do not shorten the film to fit a round number.';
    return `You are analysing a short-form video so a production pipeline can make a NEW film.
${preserveDialogue
    ? 'This is a dialogue reference. Transcribe every spoken turn accurately so the new film keeps the same conversation, speaker order, intent and sentence structure.'
    : preserveNarration ? 'This is a narrated documentary reference. Capture the complete spoken narration with timestamps, alongside the facts and corresponding visuals. The new film must preserve the events, source sequence, viewpoint and meaning with light, plain-English rewording.'
    : 'It must cover THE SAME FACTS, in the same order, with NEW wording. You extract the shape and the facts, never the script.'}

${SOURCE_DURATION ? `VERIFIED SOURCE LENGTH: ${SOURCE_DURATION} seconds. Set format.source_duration_s to ${SOURCE_DURATION}. The GUI's planned story length or clip count is NOT the video's duration. Transcribe only actual speech in this video; do not invent extra turns to fill time.` : ''}
SOURCE SCOPE: Analyse only the supplied video. Do not search for other videos,
related articles or background research. Reuse observations already obtained;
do not repeatedly retrieve the same source. If the video cannot be accessed,
report that limitation instead of inventing its contents or repeatedly retrying.

CRITICAL - THESE VIDEOS ARE FAST. They often name MANY countries or places in a
few seconds, one per second. Be EXHAUSTIVE. Do not merge two different countries
into one entry, and do not skip a quick mention. If the video names ten places,
there are TEN facts. Missing one is the failure mode this prompt exists to stop.

Reply with ONE JSON object and nothing else:

{
  "title_suggestion": "a fresh title of your own, in the same genre",
  "preset_suggestion": "${selected ? selected.id : 'the single best id from the list below'}",
  "format": {
    "source_duration_s": 0,
    "clip_seconds": ${SECONDS},
    "narration": false,
    "on_screen_text": false,
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
${preserveDialogue ? '      "source_dialogue": [{"speaker":"stable source speaker ID", "gender":"female or male or unknown", "t":"M:SS", "speaker_evidence":"visible lip movement and matching voice, or explain uncertainty", "line":"the exact spoken line in this time range"}],\n' : ''}${preserveNarration ? '      "source_narration": [{"t":"M:SS", "line":"the spoken narration in this time range, transcribed accurately"}],\n' : ''}      "visual": "what the map or shot does here: camera move, highlight, zoom"
    }
  ],
  "coverage": "one sentence confirming every fact above appears in exactly one clip",
  "notes": "anything uncertain - a place name you are guessing, a timing that overlaps"
}

RULES
${preserveNarration ? `- SOURCE NARRATION IS GROUND TRUTH. Transcribe every narrator sentence in order,
  including the opening and ending. Never substitute a summary for the transcript.
  Include all spoken content exactly once across source_narration arrays. Strip
  [music] markers. Flag unclear words in notes; do not invent missing speech.
- Record the source's corresponding shots, transitions and diagrams in visual.
  Preserve the narration's subject and tense. An event about passengers or pilots
  remains about those people, not an imagined situation involving the viewer.
` : ''}
${preserveDialogue ? `- DIALOGUE TRANSCRIPTION IS GROUND TRUTH. In every clip, source_dialogue must contain
  every spoken turn in exact order, assigned consistently to Person A and Person B.
  Preserve the actual words as closely as the audio permits. Do not summarise, improve,
  merge, expand or invent dialogue. If one word is unclear, use the best hearing and
  identify that word in notes. Never replace it with a newly written conversation.
- IDENTIFY SPEAKERS BEFORE REWRITING. Watch mouth movements and listen to the
  matching voice across the video. Use a stable ID for each person and record
  gender on EVERY turn. Female maps to Sarah; male maps to George, regardless
  of who speaks first, who asks questions, or which side they sit on. Never
  infer gender from sentence meaning, relationship stereotypes or turn order.
  Consecutive turns may belong to the same person. If attribution is uncertain,
  set gender to unknown and explain in speaker_evidence and notes; never guess.
- Keep clip boundaries aligned to the source dialogue. Do not move a reply into a
  different clip merely to make every clip contain the same number of turns.
` : ''}- Preserve the source subject, tense, exact sequence, quantities, technical meaning,
  cause and outcome when paraphrasing. Do not turn a past anecdote into "you can"
  advice. Do not invent numbers or capabilities. Stab-proof is not bulletproof.
- Include the complete original ending. Extract source facts only: the story writer
  adds any requested hook treatment and separate CTA later, not inside this analysis.
- Replace the example duration and booleans with the video's actual duration,
  whether narration is present, and whether on-screen text is present.
- "facts" is the GROUND TRUTH and must be exhaustive: one entry per distinct
  place or fact, each with its timestamp. This list is longer than the clip list
  whenever several places share a clip.
- "clips" groups those facts into clips of about ${SECONDS} seconds. A clip may hold
  one to three related facts. ${clipsLine} NEVER drop a fact to make the film shorter.
- "detail" and "points" MUST be in your own words. ${preserveDialogue || preserveNarration
    ? 'This rule does not apply to source_dialogue or source_narration: those fields transcribe the actual spoken source.'
    : 'Never reproduce the narrator\'s sentences. Reuse the facts; rewrite every line.'}
- Use the REAL place names, spelled as they are said or shown. Flag a guessed name
  in "notes".
- ${preserveNarration ? 'Keep factual names, dates, locations, flight identifiers and entities when the source states them. Do not invent them or turn factual identification into branding. Render people as faceless mannequins in the new film.' : 'No real people, channels, brands, studios, national flags or trademarks anywhere.'}
- If there is no map, describe the place, body or environment instead.

${presetInstructions}`.trim();
}

// ── the call ----------------------------------------------------------------
// ask() in write_story.js is text-only, so the video part is added here, but the
// key rotation and parsing are the same ones it uses.
//
// THE MOST EXPENSIVE CALL IN THE PIPELINE IS ALSO THE ONE MOST LIKELY TO MEET A
// BUSY MODEL. A video request holds a whole video, so "503 - this model is
// currently experiencing high demand" is routine here, and by Google's own
// wording it is temporary. This is not a dead endpoint; it is a queue.
//
// The old policy spent two tries on a model (waiting 5s, then 10s), stepped to
// the next model, and threw once six models had been walked - the whole chain
// burned in about ninety seconds. That is far too fast to outlast a demand
// spike, and the batch layer does not retry an item, so one spike lost the
// entire run plus the twenty minutes the call had already spent.
//
// The policy is now a TIME BUDGET rather than a try count: keep walking the
// chain, backing off exponentially with jitter, until the analysis lands or the
// budget is gone. Retrying is cheap - the video is handed to Gemini as a
// file_uri (the YouTube link itself), so there is no upload to repeat and no
// extra Flow credit - it costs only the minutes the call itself takes.
const WAIT_S = num('--wait', 600);   // seconds of transient trouble to sit through
const MAX_BACKOFF_MS = 45000;

// 4s, 8s, 16s, 32s, then capped at 45s, each with up to a second of jitter so
// two runs started together do not retry in lockstep and collide again.
function backoffMs(attempt, rand) {
    const base = Math.min(MAX_BACKOFF_MS, 4000 * Math.pow(2, Math.max(0, attempt - 1)));
    return base + Math.floor((rand || Math.random)() * 1000);
}

// Exported, with every side effect injectable, so the whole retry policy can be
// exercised against a fake API instead of the real one - see test_analyze_video.js.
//
// The model index is advanced BY HAND, not by the loop. Which failure happened
// decides whether the next call should keep the model (a spent key says nothing
// about the model) or move to the next one, and a `for` increment would advance
// it on every path - silently turning "rotate the key" into "rotate the key and
// skip a model".
const STRIKES_PER_MODEL = 2;

async function askVideo(ring, promptText, opts = {}) {
    // Where the video gets read. `web` hands the LINK to Google AI Studio in a
    // browser, which watches a YouTube video perfectly well - proved by asking it
    // to break one down, and getting a scene-by-scene answer carrying the model's
    // own citations. Same switch, same spelling, as write_story.js.
    const transport = opts.transport || W.TRANSPORT;
    if (transport === 'web' || (transport === 'auto' && !ring.size)) {
        return askVideoWeb(promptText, opts);
    }
    try {
        return await askVideoApi(ring, promptText, opts);
    } catch (e) {
        if (transport !== 'auto') throw e;
        console.log(`\n  the API gave up on the video (${e.status || e.message}) - ` +
                    `handing the link to AI Studio in the browser instead`);
        return askVideoWeb(promptText, opts);
    }
}

/**
 * The link, read by AI Studio.
 *
 * The prompt is the same one the API gets; what changes is how the video reaches
 * the model. The API attaches it as `file_data` with the link as the uri, so the
 * link is put in the message text instead - which is exactly what a person does
 * when they paste a YouTube URL into the chat, and what the model reads.
 *
 * The download-and-upload fallback has no equivalent here: it exists to get
 * around Google refusing to fetch a link, and there is no fetch to avoid when
 * the model is reading the page the same way a person would. A video AI Studio
 * will not read comes back as a refusal from ask_web.js, which says so.
 */
async function askVideoWeb(promptText, opts = {}) {
    const url = opts.url || URL;
    // askWebFor hands back the PARSED object already (it is the same parseJson
    // the API path uses), so parsing it a second time here reads
    // JSON.parse("[object Object]") and fails on an answer that was perfectly
    // good - which is exactly how a 9678-character content map was thrown away.
    const cm = await W.askWebFor(`${promptText}\n\nCURRENT SOURCE VIDEO: ${url}\nAnalyse only this URL. Previous videos and conversations must not supply facts or dialogue.\nThe video to analyse: ${url}`, null, { newChat: true });
    if (!cm || typeof cm !== 'object' || Array.isArray(cm)) {
        throw new Error('the reply was not a JSON content map');
    }
    return cm;
}

async function askVideoApi(ring, promptText, opts = {}) {
    const models = (opts.models || MODELS).filter(Boolean);
    if (!models.length) throw new Error('no model to call - check --model');
    const call = opts.call || ((key, model, body) => W.callApi(key, model, body));
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = opts.now || (() => Date.now());
    const log = opts.log || ((m) => console.log(m));
    const budgetMs = opts.budgetMs !== undefined ? opts.budgetMs : WAIT_S * 1000;
    const deadline = now() + budgetMs;

    let mi = 0;
    let attempt = 0;      // consecutive transient failures, across the whole walk
    let strikes = 0;      // failures on the model currently being tried
    let unusable = 0;     // models in a row this key cannot use at all
    let lap = 0;          // models walked since the last key rotation
    for (;;) {
        const model = models[mi];
        const key = ring.current;
        const body = {
            contents: [{
                parts: [
                    { text: promptText },
                    // The native path sends the link; the download fallback
                    // sends the uri of the file it uploaded. Everything else
                    // about the request is identical.
                    { file_data: opts.file || { file_uri: URL } },
                ],
            }],
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.4,
                maxOutputTokens: 8192,
            },
        };
        try {
            const cm = W.parseJson(W.geminiText(await call(key, model, body)));
            // The content map is an object. An array - now parseable, because the
            // same reader also has to accept the bare scene list a story call may
            // answer with - means the model answered a different question. "JSON"
            // in the message makes this a parse error, so it is retried instead of
            // being written out as a map with every field blank.
            if (!cm || typeof cm !== 'object' || Array.isArray(cm)) {
                throw new Error('the reply was not a JSON content map');
            }
            return cm;
        } catch (e) {
            if (W.isQuotaError(e) || W.isKeyRejected(e)) {
                if (!ring.retire()) throw e;
                const why = W.isKeyRejected(e) ? 'was rejected' : 'is out of quota';
                log(`  ${W.maskKey(key)} ${why} - switching to ${ring.label}`);
                // A spent key says nothing about the model, so keep the model.
                attempt = 0;    // a fresh key deserves a fresh budget
                strikes = 0;
                unusable = 0;
                lap = 0;
                continue;
            }
            // 404/400: this key cannot use that model at all. Not a spike, so
            // spending the budget on it would be waste - step to the next model.
            // Only when EVERY model says this is there nothing left to try.
            if (W.isModelError(e)) {
                if (++unusable >= models.length) throw e;
                mi = (mi + 1) % models.length;
                log(`  ${model} is not usable with this key - trying ${models[mi]}`);
                strikes = 0;
                continue;
            }
            if (W.isTransient(e) || W.isParseError(e)) {
                const left = deadline - now();
                if (left <= 0) {
                    // Say what was actually tried. "503 high demand" alone reads
                    // like a dead endpoint, and the operator's next move differs.
                    const mins = Math.round(budgetMs / 60000);
                    const err = new Error(`${e.message} - gave up after ${mins} min of retries ` +
                        `across ${models.join(', ')}`);
                    err.status = e.status;
                    throw err;
                }
                attempt++;
                strikes++;
                lap++;
                unusable = 0;   // real trouble, not a model-name problem
                const pause = Math.min(backoffMs(attempt), left);
                log(`  ${e.status || 'network'} from ${model} - retrying in ` +
                    `${Math.round(pause / 1000)}s (${Math.round(left / 1000)}s of budget left)`);
                await sleep(pause);
                // A model that has failed twice is not briefly busy. Walk on, so
                // one overloaded model does not hold the whole budget while a
                // quieter one sits untried - but keep retrying, because the
                // spike may be fleet-wide and the budget is what bounds us.
                if (strikes >= STRIKES_PER_MODEL && models.length > 1) {
                    strikes = 0;
                    mi = (mi + 1) % models.length;
                    log(`  ${model} is still failing - falling back to ${models[mi]}`);
                }
                // A whole pass over the chain has come back busy. Waiting is not
                // the only option: capacity is per-project and every key in the
                // ring is a different project, so hand the request to the next
                // key before settling in to outlast the spike on this one.
                if (lap >= models.length) {
                    lap = 0;
                    const was = ring.label;
                    if (ring.next()) {
                        log(`  every model is busy on ${was} - moving to ${ring.label}`);
                        // The backoff measures how long THIS key has been
                        // failing, not how long the run has. Carrying a
                        // saturated 45s wait into a key that has never been
                        // tried would spend most of the budget asleep in front
                        // of untested capacity.
                        attempt = 0;
                    }
                }
                continue;
            }
            throw e;
        }
    }
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
        console.error('Usage: node analyze_video.js <youtube-url> [--preset id] [--seconds 8] [--model m] [--out DIR] [--json] [--key K] [--wait 600] [--no-download]');
        console.error('  --wait N   seconds of "503 high demand" / network trouble to sit through');
        console.error('             before giving up, across every key and model and shared with the');
        console.error('             download fallback. Default 600. Retrying costs no credits.');
        console.error('  --model m  a model to try FIRST; the other flash models stay behind it as');
        console.error('             fallbacks unless you pass a comma-separated chain of your own.');
        console.error('  --no-download  do not fall back to downloading the video and uploading it');
        console.error('  --transport w  where the video is read: api (default), web (Google AI');
        console.error('                 Studio in the browser, no key), or auto (api, web as backup)');
        process.exit(1);
    }
    if (!/^https?:\/\//i.test(URL)) die2(`Not a URL: ${URL}`);
    if (!fs.existsSync(STYLES_FILE)) die2('styles.json not found next to analyze_video.js');

    const keys = W.apiKeys();
    // A web run reads the video in the browser, so it needs no key - and telling
    // someone with no keys to go and get one, when a keyless way to do this is
    // one flag away, is the wrong advice.
    if (!keys.length && W.TRANSPORT !== 'web') {
        die2('No Gemini key. Add one on the GUI Script tab, set GEMINI_API_KEY, or pass --key.\n' +
             '  (Or read the video in the browser instead, with no key at all: --transport web)');
    }
    const ring = new W.KeyRing(keys);
    console.log(`Analysing ${URL}\n  ${ring.label}, models ${MODELS.join(' -> ')}, ${SECONDS}s per clip`);
    if (W.TRANSPORT === 'web') {
        console.log('  (Google AI Studio watches the video in the browser - no key is used,');
        console.log('   and the answer comes back through the same parser.)');
    } else {
        console.log(`  (Gemini reads the video; this can take a little while. A "high demand"`);
        console.log(`   503 is retried for up to ${Math.round(WAIT_S / 60)} min in total, across every`);
        console.log('   key and model - retries cost no credits.)');
    }

    // ONE budget for the whole analysis, not one per transport. The link attempt
    // and the download fallback draw on the same clock, so `--wait 600` bounds
    // the step at ten minutes of retrying instead of ten minutes plus a second
    // ten behind it - which is what made a bad spike look like a hang.
    const budgetMs = WAIT_S * 1000;
    const startedAt = Date.now();

    let cm;
    try {
        cm = await askVideo(ring, buildPrompt(), { budgetMs });
    } catch (e) {
        // THE LINK ON ITS OWN IS ONLY ONE WAY IN. When Google will not fetch
        // it - a demand spike, an age-gated or private video, a link shape it
        // does not recognise - download the video and upload the bytes, which
        // is a different transport with its own quota and its own limits. This
        // is the step that turns "the analysis failed" into "the analysis took
        // longer".
        //
        // Not on a web run. There is no upload in that path - AI Studio reads the
        // link the way a person does - so downloading a file and then sending a
        // prompt that never mentions it would spend minutes of yt-dlp to change
        // nothing.
        const canFallBack = !NO_DOWNLOAD && W.TRANSPORT !== 'web' && V.isYouTube(URL);
        if (!canFallBack) die2(`Video analysis failed: ${e.message}`);
        if (!V.ytDlpPath()) {
            die2(`Video analysis failed: ${e.message}\n` +
                '  (The download fallback is unavailable: yt-dlp is not installed or not on PATH.)');
        }
        console.log(`\n  the link alone is not getting through: ${e.message}`);
        console.log('  falling back to download + upload - this takes a few minutes.');

        // Whatever is left of the budget, never less than two minutes: the
        // download and the upload eat into the same clock, and a slow one must
        // not leave the fallback with nothing to retry on.
        const left = Math.max(120000, budgetMs - (Date.now() - startedAt));
        let src = null;
        let failure = null;
        try {
            src = await V.videoSource(URL, ring.current, { log: (m) => console.log(`  ${m}`) });
            cm = await askVideo(ring, buildPrompt(), {
                file: { file_uri: src.file_uri, mime_type: src.mime_type },
                budgetMs: left,
            });
            console.log(`  analysed from the uploaded file (${(src.bytes / 1048576).toFixed(1)}MB).`);
        } catch (e2) {
            failure = e2;
        }
        // Free the storage quota and the temp file on BOTH paths. This is not a
        // `finally` because the failure branch exits the process, and
        // process.exit() terminates without unwinding - a finally here would
        // never run and every failed run would leak the upload.
        if (src) { try { await src.cleanup(); } catch (e3) { /* best effort */ } }
        if (failure) {
            die2(`Video analysis failed: ${e.message}\n` +
                `  and the download + upload fallback failed too: ${failure.message}`);
        }
    }

    if (require('./reference_duration').sourceUnavailable(cm)) {
        die2('Gemini reports that the source video was unavailable. Refusing to save its dialogue as a verified transcript. Upload the source video or provide the actual labelled transcript.');
    }
    if (SOURCE_DURATION) {
        if (require('./reference_duration').timingMismatch(cm, SOURCE_DURATION, SECONDS)) {
            die2(`Analysis duration/timestamps do not match the verified ${SOURCE_DURATION}s source. Refusing to cache an expanded script. Retry source analysis; no story was written.`);
        }
        cm.source_metadata = { duration_s: SOURCE_DURATION, verified_by: 'yt-dlp video metadata', url: URL };
        cm.format = { ...(cm.format || {}), source_duration_s: SOURCE_DURATION };
    }
    if (PRESET && W.loadPreset(PRESET).preserve_source_narration && !require('./source_narration').hasNarration(cm)) {
        die2('Source analysis is missing the complete source_narration fields. Nothing was cached as a faithful transcription. Supply the video transcript or retry analysis.');
    }
    if (PRESET && W.loadPreset(PRESET).require_source_speaker_gender) {
        require('./dialogue_speakers').sourceSpeakerMap(clipItems(cm), [], W.loadPreset(PRESET));
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
})().then(() => { require('./ask_web').close(); }).catch((e) => { require('./ask_web').close(); console.error('FAILED: ' + (e && e.message)); process.exit(1); });

module.exports = { buildDetail, buildPrompt, slugOf, clipItems, askVideo, backoffMs, modelChain };
