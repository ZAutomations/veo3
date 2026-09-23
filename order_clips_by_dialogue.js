#!/usr/bin/env node
/**
 * ORDER CLIPS BY THEIR OWN DIALOGUE
 * =================================
 * Puts a downloaded clip set back into story order by listening to it.
 *
 * THE PROBLEM. Agent Mode sends all N scenes as one prompt, Flow queues them and
 * renders them as the queue drains, and the project grid fills up in COMPLETION
 * order. So the grid - and therefore the file numbers agent_download.js writes -
 * are unrelated to the story. Measured on stories/the_price_of_obligation, the
 * grid held scenes 11,13,10,14,12,5,7,6,3,9,2,8,4,1: neither the story order nor
 * its reverse. Nothing in the downloaded artefacts recovers the order either:
 *
 *   - Flow's own tile captions are generic and repeat (three tiles all said
 *     exactly "Godwin and Tari arguing bedroom"). A word-overlap test against
 *     the scene titles resolved 7 distinct scenes out of 14 - a coin flip.
 *   - the tile's video CDN URL is a random UUID, with no scene in it
 *   - the mp4 carries no scene metadata (encoder=Google and nothing else)
 *
 * WHAT IS ACTUALLY IN THE FILE. Every scene has its own words, and the clip
 * speaks them: an 8s clip carries an 8s AAC track of that scene's dialogue. So
 * the clip identifies itself if you transcribe it. Transcription runs LOCALLY
 * through whisper - no API key, no quota, and nothing leaves the machine. If
 * whisper is not installed the tool says so and refuses, rather than falling
 * back to a guess.
 *
 * WHAT IT WRITES. Resolved clips are re-ordered in clips/manifest.json, which
 * is the order source join_clips.js already trusts - so a plain
 * `node join_clips.js <clips_dir>` then joins the film correctly, with no
 * --order and no --reverse. A clip that could not be identified keeps its
 * existing position and is marked `"match_cover": null`, and the run says which
 * ones those are. Nothing is renamed and nothing is deleted; the previous
 * manifest is kept beside it as manifest.json.before-order-backup.
 *
 * SPEED. whisper is CPU-bound: about 3s per 8s clip for the `base` model on this
 * machine, so a 14-clip film is well under a minute. Transcripts are cached in
 * clips/.transcripts/ keyed by file size and mtime, so a re-run of the same
 * unchanged clips is instant. `--model tiny` is faster and coarser; base is the
 * default because the margin between the right scene and the runner-up is what
 * makes the answer trustworthy.
 *
 * Usage:
 *   node order_clips_by_dialogue.js stories/the_price_of_obligation --dry-run
 *   node order_clips_by_dialogue.js stories/the_price_of_obligation --write
 *   node order_clips_by_dialogue.js <story.json> --clips DIR --model tiny --write
 *
 *   --dry-run        print the resolved order, write nothing            (default)
 *   --write          rewrite clips/manifest.json into story order
 *   --clips DIR      clips folder (default <story dir>/clips)
 *   --model NAME     whisper model (default base; tiny is faster, coarser)
 *   --language CODE  spoken language (default en)
 *   --min-cover F    a clip must contain this share of a scene's words to count
 *                    as that scene (default 0.5)
 *
 * The matching itself is exported so it can be tested without whisper, without
 * audio and without the network - see test_clip_order.js.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function ts() { return new Date().toTimeString().slice(0, 8); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function banner(msg) { console.log(`\n${'='.repeat(70)}\n${msg}\n${'='.repeat(70)}`); }

// ── the story ----------------------------------------------------------------
// Accepts the story JSON or its folder, the same way mcp_server.js does, so the
// thing you already have in hand is enough to call this.
function resolveStoryJson(p) {
    if (!p) return null;
    const abs = path.resolve(p);
    try {
        const st = fs.statSync(abs);
        if (st.isFile() && abs.toLowerCase().endsWith('.json')) return abs;
        if (st.isDirectory()) {
            const f = fs.readdirSync(abs).find(x => x.toLowerCase().endsWith('_story.json'));
            return f ? path.join(abs, f) : null;
        }
    } catch (e) { /* does not exist */ }
    return null;
}

// What each scene SAYS. Dialogue is the first choice because it is what the
// characters speak. A narrated film has no dialogue, but its script_line is what
// the narrator reads over that clip, so it identifies the clip just as well.
// A scene with neither is unidentifiable, and is reported as such rather than
// guessed at.
function sceneWords(sc) {
    const dlg = (Array.isArray(sc.dialogue) ? sc.dialogue : [])
        .map(d => String((d && d.line) || '').trim()).filter(Boolean).join(' ');
    if (dlg) return { text: dlg, from: 'dialogue' };
    const line = String(sc.script_line || '').trim();
    if (line) return { text: line, from: 'script_line' };
    return { text: '', from: 'none' };
}
function wantedFrom(story) {
    return (Array.isArray(story.scenes) ? story.scenes : []).map((sc, i) => {
        const w = sceneWords(sc);
        return {
            n: Number(sc._scene_number) || (i + 1),
            title: String(sc._scene_title || `scene ${i + 1}`),
            text: w.text, from: w.from,
        };
    });
}

// ── matching ----------------------------------------------------------------
// How much of a scene's own wording is present in what the clip says. Both sides
// are reduced to lowercase word sets, so whisper's missing punctuation and its
// "i m" for "I'm" cost nothing.
//
// The stop list is this long on purpose: a match has to rest on words the scene
// MEANS, not on the grammar it shares with every other line. With a short list a
// scene like "you and the of" scored a full 1.0 against a clip that shared one
// function word, and two clips could tie on "you never ask about mine" alone.
const STOP = new Set(('a an the and or but if then than so as of to in on at by for with from into over ' +
    'under about after before between during without within up down out off again further once here there ' +
    'when where why how all any both each few more most other some such no nor not only own same too very ' +
    'can could will would shall should may might must do does did doing done be am is are was were been ' +
    'being have has had having i me my myself we us our ours you your yours he him his she her hers it its ' +
    'they them their theirs this that these those who whom whose which what just now also ever get got ' +
    's t ll re ve m d').split(/\s+/));
const words = (t) => new Set(String(t || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1));

// Decide which clip is which scene. Best-first, one clip per scene: taking the
// strongest pair first is what stops two clips that share a phrase from both
// claiming the same scene.
//
// Returns { byFile, unresolved }, where byFile maps every clip to
// { scene, cover } - cover is null for a clip nothing identified, and such a
// clip is also listed in `unresolved`. Unidentified clips and unmatched scenes
// are paired off in the order they already stand, so the caller always gets a
// complete order and never a silently guessed scene presented as a fact.
function matchClips(clips, heard, wanted, minCover = 0.5) {
    const identifiable = wanted.filter(w => w.text);
    const pairs = [];
    for (const f of clips) {
        const said = words(heard[f]);
        if (!said.size) continue;
        for (const w of identifiable) {
            const want = [...words(w.text)].filter(x => !STOP.has(x));
            if (!want.length) continue;
            let hit = 0;
            for (const x of want) if (said.has(x)) hit++;
            // One shared word is not evidence. Two scenes in the same room both
            // say "bed" and both name the same two people, so a single hit would
            // let a clip claim the wrong scene on a common word. Two hits is the
            // bar - or the whole line, when a line is only one content word long
            // and there is nothing else to go on.
            if (hit < Math.min(2, want.length)) continue;
            pairs.push({ file: f, scene: w.n, cover: hit / want.length });
        }
    }
    pairs.sort((a, b) => b.cover - a.cover || a.file.localeCompare(b.file));

    const byFile = {}, byScene = {};
    for (const p of pairs) {
        if (byFile[p.file] || byScene[p.scene]) continue;
        if (p.cover < minCover) continue;
        byFile[p.file] = { scene: p.scene, cover: p.cover };
        byScene[p.scene] = p;
    }

    const unresolved = [];
    const leftClips = clips.filter(f => !byFile[f]);
    const leftScenes = identifiable.filter(w => !byScene[w.n]).map(w => w.n);
    for (let i = 0; i < leftClips.length; i++) {
        const sc = leftScenes[i];
        const rec = { scene: sc === undefined ? null : sc, cover: null };
        byFile[leftClips[i]] = rec;
        unresolved.push(leftClips[i]);
    }
    return { byFile, unresolved };
}

// Clips in story order. An unidentified clip has no scene number, so it sorts to
// the end and stays in the relative order it already had.
function orderOf(clips, byFile) {
    return clips.slice().sort((a, b) => {
        const sa = byFile[a].scene === null ? Infinity : byFile[a].scene;
        const sb = byFile[b].scene === null ? Infinity : byFile[b].scene;
        return (sa - sb) || (clips.indexOf(a) - clips.indexOf(b));
    });
}
const orderString = (ordered) => ordered.map(f => f.replace(/\.mp4$/i, '')).join(',');

// ── CLI ----------------------------------------------------------------------
function main() {
    const argv = process.argv.slice(2);
    function flag(name, def = null) {
        const i = argv.indexOf(name);
        if (i < 0) return def;
        const v = argv[i + 1];
        return (v && !v.startsWith('--')) ? v : true;
    }

    const TARGET = argv.find(a => !a.startsWith('--'));
    if (!TARGET) {
        console.error('Usage: node order_clips_by_dialogue.js <story_json_or_folder> [--clips DIR] [--write] [--dry-run] [--model base] [--language en]');
        process.exit(1);
    }

    const WRITE     = !!flag('--write', false);
    const MODEL     = typeof flag('--model') === 'string' ? flag('--model') : 'base';
    const LANGUAGE  = typeof flag('--language') === 'string' ? flag('--language') : 'en';
    const MIN_COVER = Number(flag('--min-cover', 0.5));

    const STORY_JSON = resolveStoryJson(TARGET);
    if (!STORY_JSON) {
        console.error(`Not a story JSON or a folder holding one: ${TARGET}`);
        process.exit(1);
    }
    const CLIPS_DIR = typeof flag('--clips') === 'string'
        ? path.resolve(flag('--clips'))
        : path.join(path.dirname(STORY_JSON), 'clips');
    if (!fs.existsSync(CLIPS_DIR)) {
        console.error(`No clips folder: ${CLIPS_DIR}`);
        process.exit(1);
    }

    const story = JSON.parse(fs.readFileSync(STORY_JSON, 'utf8'));
    const wanted = wantedFrom(story);
    if (!wanted.length) {
        console.error('The story has no scenes.');
        process.exit(1);
    }

    // ── the clips ────────────────────────────────────────────────────────────
    const SKIP = /(_final|_joined|_concat)\.mp4$/i;
    let clips = fs.readdirSync(CLIPS_DIR)
        .filter(f => /\.mp4$/i.test(f) && !SKIP.test(f))
        .sort();
    if (!clips.length) {
        console.error(`No .mp4 clips in ${CLIPS_DIR}`);
        process.exit(1);
    }
    // manifest.json is where the resolved order is recorded, and join_clips.js
    // reads exactly this list - keep every other field when rewriting it.
    const MANIFEST = path.join(CLIPS_DIR, 'manifest.json');
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) { manifest = null; }
    if (manifest && Array.isArray(manifest.clips)) {
        // The manifest's own order is the downloader's best knowledge; use it as
        // the starting order so an unidentified clip keeps a sensible place.
        const listed = manifest.clips.map(c => c && c.file).filter(f => f && clips.includes(f));
        clips = [...listed, ...clips.filter(f => !listed.includes(f))];
    }

    banner('ORDER CLIPS BY DIALOGUE');
    log(`Story   : ${path.relative(process.cwd(), STORY_JSON)}`);
    log(`Clips   : ${path.relative(process.cwd(), CLIPS_DIR)}  (${clips.length} clip(s))`);
    log(`Scenes  : ${wanted.length}  (${wanted.filter(w => w.from === 'dialogue').length} with dialogue, `
        + `${wanted.filter(w => w.from === 'script_line').length} on the narrator's line, `
        + `${wanted.filter(w => w.from === 'none').length} with neither)`);

    if (wanted.filter(w => w.text).length < 2) {
        console.error('\nNothing to match on: fewer than two scenes have words to listen for.');
        console.error('This film is silent or the story was written without lines, so the clips');
        console.error('cannot be told apart by ear. Order them by eye with join_clips.js --order.');
        process.exit(1);
    }

    // ── transcribe ───────────────────────────────────────────────────────────
    // Local only. whisper writes <basename>.txt per input, and the model is
    // loaded once for the whole batch, which is why every file goes in one call.
    const CACHE = path.join(CLIPS_DIR, '.transcripts');
    const INDEX = path.join(CACHE, 'index.json');
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch (e) { cache = {}; }

    const fresh = (f) => {
        const st = fs.statSync(path.join(CLIPS_DIR, f));
        const c = cache[f];
        return c && c.size === st.size && c.mtime === st.mtimeMs
            && fs.existsSync(path.join(CACHE, f.replace(/\.mp4$/i, '.txt')));
    };
    const need = clips.filter(f => !fresh(f));
    const reuse = clips.length - need.length;
    if (reuse) log(`Transcripts: ${reuse} cached, ${need.length} to transcribe`);

    if (need.length) {
        fs.mkdirSync(CACHE, { recursive: true });
        log(`Transcribing ${need.length} clip(s) with whisper "${MODEL}" - local, no API key.`);
        try {
            execFileSync('whisper', [
                ...need.map(f => path.join(CLIPS_DIR, f)),
                '--model', MODEL,
                '--language', LANGUAGE,
                '--output_format', 'txt',
                '--output_dir', CACHE,
                '--verbose', 'False',
                '--fp16', 'False',
            ], { stdio: ['ignore', 'ignore', 'inherit'] });
        } catch (e) {
            console.error('\nwhisper failed or is not installed.');
            console.error('Install it with:  pip install openai-whisper');
            console.error('Without a transcript the order cannot be established from the clips.');
            process.exit(1);
        }
        for (const f of need) {
            const st = fs.statSync(path.join(CLIPS_DIR, f));
            cache[f] = { size: st.size, mtime: st.mtimeMs };
        }
        fs.writeFileSync(INDEX, JSON.stringify(cache, null, 2));
    }
    const heard = {};
    for (const f of clips) {
        const t = path.join(CACHE, f.replace(/\.mp4$/i, '.txt'));
        heard[f] = fs.existsSync(t) ? fs.readFileSync(t, 'utf8').trim() : '';
    }

    const { byFile, unresolved } = matchClips(clips, heard, wanted, MIN_COVER);
    if (!Object.values(byFile).some(m => m.cover !== null)) {
        console.error('\nNo clip matched any scene - the transcripts hold nothing recognisable.');
        console.error('Check that the story is the one these clips were generated from.');
        process.exit(1);
    }
    const ordered = orderOf(clips, byFile);

    // ── report ───────────────────────────────────────────────────────────────
    console.log('');
    log('what each clip actually says, and the scene it belongs to:');
    for (const f of ordered) {
        const m = byFile[f];
        const sc = m.scene === null ? null : wanted.find(w => w.n === m.scene);
        const said = heard[f].replace(/\s+/g, ' ').slice(0, 44);
        const cover = m.cover === null ? '  ??  ' : `${(m.cover * 100).toFixed(0).padStart(3)}%  `;
        console.log(`  scene ${String(m.scene === null ? '--' : m.scene).padStart(2)}  ${cover}`
            + `${f.padEnd(15)} ${sc ? sc.title.slice(0, 22).padEnd(23) : 'UNIDENTIFIED'.padEnd(23)} ${said}`);
    }

    console.log('');
    const resolved = ordered.filter(f => byFile[f].cover !== null).length;
    log(`Resolved: ${resolved} of ${clips.length} clip(s) matched a scene by ear.`);
    if (unresolved.length) {
        log(`WARNING: ${unresolved.length} clip(s) could not be matched and keep their previous`);
        for (const f of unresolved) log(`         ${f}`);
        log('         position. Check those by eye before publishing.');
        const none = wanted.filter(w => w.from === 'none').map(w => w.n);
        if (none.length) log(`         (scenes with no words to match on: ${none.join(', ')})`);
    }
    console.log('');
    log(`Story order: ${orderString(ordered)}`);
    console.log('');
    log(`Or without touching the manifest:  node join_clips.js "${path.relative(process.cwd(), CLIPS_DIR)}" --order ${orderString(ordered)}`);

    // ── write ────────────────────────────────────────────────────────────────
    if (!WRITE) {
        console.log('');
        log('--dry-run (default): nothing written. Re-run with --write to record this');
        log('order in clips/manifest.json, which join_clips.js then follows by itself.');
        return;
    }

    // join_clips.js reads manifest.clips[] in array order and does not care what
    // the other fields say, so the reorder is expressed by the array itself. Each
    // clip also records the scene it was heard to be, which is the audit trail for
    // the next person who wonders why scene-07.mp4 is in position 6.
    const meta = new Map();
    if (manifest && Array.isArray(manifest.clips)) {
        for (const c of manifest.clips) if (c && c.file) meta.set(c.file, c);
    }
    const out = {
        ...(manifest || {}),
        projectUrl: (manifest && manifest.projectUrl) || null,
        clips: ordered.map((f, i) => Object.assign({}, meta.get(f) || { file: f }, {
            order: i + 1,
            file: f,
            matched_scene: byFile[f].scene,
            match_cover: byFile[f].cover === null ? null : Number(byFile[f].cover.toFixed(2)),
            match_from: byFile[f].scene === null ? null
                : (wanted.find(w => w.n === byFile[f].scene) || {}).from || null,
        })),
        orderResolvedBy: 'dialogue',
        orderResolvedAt: new Date().toISOString(),
        orderModel: MODEL,
        orderNote: 'clips[] is in STORY order, resolved by transcribing each clip locally and '
            + 'matching it to the scene whose words it speaks. join_clips.js follows this array, '
            + 'so no --order and no --reverse is needed. matched_scene is the story scene number.',
    };
    if (fs.existsSync(MANIFEST)) {
        const bak = MANIFEST + '.before-order-backup';
        if (!fs.existsSync(bak)) fs.copyFileSync(MANIFEST, bak);
        log(`Previous manifest kept as ${path.basename(bak)}`);
    }
    fs.writeFileSync(MANIFEST, JSON.stringify(out, null, 2));
    log(`Wrote ${path.relative(process.cwd(), MANIFEST)} with clips in story order.`);
    console.log('');
    log(`Next:  node join_clips.js "${path.relative(process.cwd(), CLIPS_DIR)}"`);
}

if (require.main === module) main();

module.exports = { resolveStoryJson, sceneWords, wantedFrom, words, matchClips, orderOf, orderString };
