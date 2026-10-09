#!/usr/bin/env node
/**
 * JOIN CLIPS WITH FFMPEG  (Agent Mode post-processing)
 * ====================================================
 * Agent Mode emits DISCRETE CLIPS - one per scene - so finishing a video is a
 * CONCAT, the opposite of the ingredients path, which produces one continuous
 * timeline and needs splitIntoScenes(). Keep the two straight:
 *
 *   ingredients path : 1 long export  -> ffmpeg -ss/-t SPLIT -> scene-01..N.mp4
 *   Agent Mode       : N separate files -> ffmpeg concat    -> one final .mp4
 *
 * ORDER IS THE WHOLE PROBLEM. The clip files arrive from Flow named by the
 * browser, in whatever order they were clicked, and scene 1 is not guaranteed
 * to be first. So the order here is explicit and inspectable:
 *
 *   1. If files are named scene-01.mp4, scene-02.mp4 ... they are sorted
 *      NATURALLY (scene-10 after scene-9, not after scene-1) and used as-is.
 *   2. Otherwise they are joined in the order given by --order, or by the
 *      manifest.json the downloader writes, or finally by filename.
 *
 * Run with --dry-run to print the exact join order and exit - check that
 * BEFORE spending an encode. A wrong order is silent: ffmpeg will happily
 * produce a perfectly valid video with the scenes shuffled.
 *
 * Usage:
 *   node join_clips.js <clips_dir>
 *   node join_clips.js <clips_dir> --out final.mp4
 *   node join_clips.js <clips_dir> --dry-run
 *   node join_clips.js <clips_dir> --order scene-03,scene-01,scene-02
 *   node join_clips.js <clips_dir> --reencode      (if -c copy refuses)
 *
 * Flags:
 *   --out FILE     output path (default <clips_dir>/../<folder>_final.mp4)
 *   --order LIST   comma-separated basenames (with or without .mp4), in order
 *   --reverse      join back-to-front (Flow's grid is often newest-first)
 *   --reencode     re-encode instead of stream-copy. Slower, always works.
 *   --copy         force the stream copy even when the clips' parameters differ.
 *                  Expect a file whose format changes mid-playback. You asked.
 *   --dry-run      print the plan, write nothing
 *   --normalize-audio balance loudness per clip (automatic for dialogue stories)
 *   --no-normalize-audio keep the original clip loudness
 *   --allow-partial export available clips when scenes are missing; keeps the
 *                  story incomplete and defaults to clips_partial.mp4.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function ts() { return new Date().toTimeString().slice(0, 8); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function banner(msg) { console.log(`\n${'='.repeat(70)}\n${msg}\n${'='.repeat(70)}`); }

const argv = process.argv.slice(2);
function flag(name, def = null) {
    const i = argv.indexOf(name);
    if (i < 0) return def;
    const v = argv[i + 1];
    return (v && !v.startsWith('--')) ? v : true;
}

const DIR = argv.find(a => !a.startsWith('--'));
if (!DIR) {
    console.error('Usage: node join_clips.js <clips_dir> [--out final.mp4] [--dry-run] [--order a,b,c] [--reverse] [--reencode]');
    process.exit(1);
}
if (!fs.existsSync(DIR) || !fs.statSync(DIR).isDirectory()) {
    console.error(`Not a folder: ${DIR}`);
    process.exit(1);
}

const OUT_FLAG  = typeof flag('--out') === 'string' ? flag('--out') : null;
const ORDER_RAW = typeof flag('--order') === 'string' ? flag('--order') : null;
const REVERSE   = !!flag('--reverse', false);
const REENCODE  = !!flag('--reencode', false);
const DRY_RUN   = !!flag('--dry-run', false);
const ALLOW_PARTIAL = !!flag('--allow-partial', false);

// ── collect the clip files ---------------------------------------------------
const SKIP = /(_final|_joined|_concat)\.mp4$/i;
const files = fs.readdirSync(DIR)
    .filter(f => /\.mp4$/i.test(f) && !SKIP.test(f))
    .filter(f => !/\.part$/i.test(f));

if (!files.length) {
    console.error(`No .mp4 files in ${DIR}`);
    process.exit(1);
}

const MANIFEST_PATH = path.join(DIR, 'manifest.json');
let savedManifest = null;
if (fs.existsSync(MANIFEST_PATH)) {
    try { savedManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); }
    catch { /* the existing fallback below reports an unreadable manifest */ }
}
const expectedClips = Number(savedManifest && savedManifest.expected) || 0;
// Explicit ordering is a deliberate selection by the caller. It must be
// checked before consulting an obsolete complete:false flag; otherwise even
// a manually selected, correctly ordered film can never be joined.
let manualOrder = null;
if (ORDER_RAW) {
    manualOrder = ORDER_RAW.split(',').map(s => s.trim()).filter(Boolean).map(name => {
        const norm = (/\.mp4$/i.test(name) ? name : name + '.mp4').toLowerCase();
        return files.find(f => f.toLowerCase() === norm);
    });
    if (manualOrder.some(f => !f) || new Set(manualOrder).size !== manualOrder.length
        || !manualOrder.length
        || (expectedClips > 0 && (ALLOW_PARTIAL ? manualOrder.length > expectedClips : manualOrder.length !== expectedClips))) {
        console.error(`REFUSING TO JOIN: explicit order must name ${expectedClips || 'distinct existing'} clips, without missing files or duplicates.`);
        process.exit(2);
    }
    // Check real media, rather than treating filename existence as success.
    for (const file of manualOrder) {
        const validation = require('./download_media_validation').playableVideo(path.join(DIR, file));
        if (!validation.ok) {
            console.error(`REFUSING TO JOIN: ${file}: ${validation.why}`);
            process.exit(2);
        }
    }
    if (savedManifest) {
        const previous = savedManifest;
        savedManifest = { ...previous, complete: !expectedClips || manualOrder.length === expectedClips, orderResolvedBy: 'manual',
            orderResolvedAt: new Date().toISOString(),
            clips: manualOrder.map((file, i) => ({file, order:i+1, matched_scene:i+1,
                match_from:'manual', got:true})),
            alternateClips: (previous.clips || []).filter(c => !manualOrder.includes(c.file)),
        };
        if (!DRY_RUN) {
            const backup = MANIFEST_PATH + '.before-manual-order-' + Date.now();
            fs.copyFileSync(MANIFEST_PATH, backup);
            fs.writeFileSync(MANIFEST_PATH, JSON.stringify(savedManifest, null, 2));
        }
    }
}
if (savedManifest && expectedClips) {
    const resolved = require('./download_tile_logic').resolveSceneManifest(savedManifest);
    if (resolved !== savedManifest && resolved.clips.every(c => files.includes(c.file))) {
        const backup = MANIFEST_PATH + '.before-extra-resolution';
        if (!DRY_RUN && !fs.existsSync(backup)) fs.copyFileSync(MANIFEST_PATH, backup);
        savedManifest = resolved;
        if (!DRY_RUN) fs.writeFileSync(MANIFEST_PATH, JSON.stringify(resolved, null, 2));
        log(`Selected ${resolved.clips.length} story scenes; keeping ${resolved.alternateClips.length} alternate clip(s) outside the join.`);
    }
}
const readyInManifest = savedManifest && Array.isArray(savedManifest.clips)
    ? new Set(savedManifest.clips.filter(c => c && c.got !== false && c.file
        && fs.existsSync(path.join(DIR, c.file))).map(c => c.file)).size : files.length;
const partialExport = ALLOW_PARTIAL && expectedClips > 0 && readyInManifest > 0 && readyInManifest < expectedClips;
if ((savedManifest && savedManifest.complete === false || expectedClips && readyInManifest !== expectedClips) && !partialExport) {
    console.error(`REFUSING TO JOIN: story expects ${expectedClips} clips; manifest has ${readyInManifest} ready and folder has ${files.length} MP4 files.`);
    console.error(readyInManifest === expectedClips
        ? 'All files are present, but scene order is unresolved or the manifest is stale. Resolve clip order, or provide --order with your verified story order.'
        : readyInManifest > expectedClips
        ? 'Extra clips need scene matching. Run Resolve clip order to identify one clip per story scene; files are kept.'
        : 'The story is incomplete or has missing files. Download or resolve the missing scenes before joining.');
    process.exit(2);
}
if (partialExport) log(`PARTIAL EXPORT: joining ${readyInManifest} available clips; ${expectedClips - readyInManifest} story clip(s) are missing. The story remains incomplete.`);

// Natural sort: scene-2 before scene-10. A plain string sort gets this wrong,
// and the result is a valid video in the wrong story order.
const natKey = (s) => s.toLowerCase().replace(/(\d+)/g, (n) => ' ' + String(n).padStart(10, '0'));

// ── decide the join order ----------------------------------------------------
let ordered;
let orderSource;

// An explicit --order wins over everything, and is checked loudly: a typo that
// silently drops a clip would produce a video missing a scene.
if (ORDER_RAW) {
    orderSource = '--order flag';
    ordered = manualOrder;
    const missing = files.filter(f => !ordered.includes(f));
    if (missing.length) {
        log(`WARNING: ${missing.length} clip(s) not named in --order and will NOT be joined:`);
        for (const f of missing) log(`         ${f}`);
    }
} else if (fs.existsSync(path.join(DIR, 'manifest.json'))) {
    // The downloader writes manifest.json recording the scene order it saw. Trust
    // that over the filenames, because the filenames come from the browser.
    orderSource = 'manifest.json';
    try {
        const man = savedManifest || JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
        const listed = (man.clips || []).map(c => c.file).filter(Boolean);
        ordered = listed.filter(f => files.includes(f));
        const missing = files.filter(f => !ordered.includes(f));
        const alternates = new Set((man.alternateClips || []).map(c => c.file));
        for (const f of missing) if (!alternates.has(f)) ordered.push(f);
        if (!ordered.length) { ordered = [...files].sort((a, b) => natKey(a).localeCompare(natKey(b))); orderSource = 'filename (manifest was empty)'; }
    } catch (e) {
        log(`manifest.json unreadable (${e.message}) - falling back to filename order.`);
        ordered = [...files].sort((a, b) => natKey(a).localeCompare(natKey(b)));
        orderSource = 'filename';
    }
} else {
    orderSource = 'filename (natural sort)';
    ordered = [...files].sort((a, b) => natKey(a).localeCompare(natKey(b)));
}

if (REVERSE) {
    ordered.reverse();
    orderSource += ' + reversed';
}

// ── ffprobe: duration AND stream parameters --------------------------------
// Takes a FULL path. It used to take a filename and join it onto DIR, which
// silently broke for the output file (that one lives beside the folder, not in
// it) - ffprobe failed, and the failure was invisible because a fallback
// re-queried it with the right path. One argument shape, no ambiguity.
// stdio is pinned because execFileSync otherwise forwards the child's stderr to
// ours, which is how a harmless probe turned into a scary line on screen.
function probe(fullPath) {
    try {
        const out = execFileSync('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,sample_rate,channels,time_base,start_time,duration,avg_frame_rate',
            '-of', 'json',
            fullPath,
        ], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
        const j = JSON.parse(out);
        const v = (j.streams || []).find(s => s.codec_type === 'video') || {};
        const a = (j.streams || []).find(s => s.codec_type === 'audio') || {};
        const d = parseFloat(j.format && j.format.duration);
        return {
            duration: Number.isFinite(d) ? d : null,
            vcodec: v.codec_name || null,
            width: v.width || null,
            height: v.height || null,
            acodec: a.codec_name || null,
            sampleRate: a.sample_rate || null,
            channels: a.channels || null,
            videoDuration: Number(v.duration) > 0 ? Number(v.duration) : null,
            videoStart: Number(v.start_time) || 0,
            audioStart: Number(a.start_time) || 0,
            audioDuration: Number(a.duration) > 0 ? Number(a.duration) : null,
            fps: v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : null,
            videoTimeBase: v.time_base || null,
            audioTimeBase: a.time_base || null,
        };
    } catch {
        return null;
    }
}

// Everything that must match for a stream copy to be safe. -c copy does NOT
// verify this: fed a 320x240 and a 640x480 clip, ffmpeg exits 0 and writes a
// file whose resolution changes mid-playback. That is silent corruption, so it
// is checked here and the join is forced to re-encode instead.
const sig = (p) => p ? [p.vcodec, p.width, p.height, p.acodec, p.sampleRate, p.channels, p.fps, p.videoTimeBase, p.audioTimeBase].join('|') : 'unprobeable';

banner('JOIN PLAN');
log(`Folder     : ${DIR}`);
log(`Clips found: ${files.length}`);
log(`Order from : ${orderSource}`);
log('');
let total = 0;
const probes = new Map();
ordered.forEach((f, i) => {
    const full = path.join(DIR, f);
    const p = probe(full);
    probes.set(f, p);
    const d = p ? (p.videoDuration || p.duration) : null;
    if (d != null) total += d;
    const sz = (fs.statSync(full).size / 1048576).toFixed(1);
    const spec = p && p.width ? `${p.width}x${p.height} ${p.vcodec}/${p.acodec || 'no-audio'}` : 'unknown';
    log(`  ${String(i + 1).padStart(2, '0')}. ${f.padEnd(28)} ${(d != null ? d.toFixed(2) + 's' : '  ?  ').padStart(7)}  ${sz.padStart(5)} MB  ${spec}`);
});
log('');
log(`Total      : ${total ? total.toFixed(2) + 's (about ' + Math.round(total) + 's)' : 'unknown'}`);
if (files.length !== ordered.length) {
    log(`NOTE       : ${files.length - ordered.length} clip(s) excluded by the order above.`);
}

// A mismatch here is the one thing a stream copy gets wrong quietly.
const sigs = [...new Set(ordered.map(f => sig(probes.get(f))))];
const MISMATCH = sigs.length > 1;
if (MISMATCH) {
    log('');
    log('WARNING: these clips do NOT share identical video/audio parameters:');
    for (const s of sigs) {
        const who = ordered.filter(f => sig(probes.get(f)) === s);
        log(`         [${s}]  <- ${who.join(', ')}`);
    }
    log('         A stream copy would produce a file that changes format mid-playback,');
    log('         with no error. Forcing a re-encode.');
}
// --copy forces the stream copy even on a mismatch, for anyone who knows better.
const FORCE_COPY = !!flag('--copy', false);
let dialogueStory = false;
const storyFolder = path.dirname(path.resolve(DIR));
const storyFiles = fs.readdirSync(storyFolder).filter(f => /_story\.json$/i.test(f));
if (storyFiles.length === 1) {
    try { dialogueStory = JSON.parse(fs.readFileSync(path.join(storyFolder, storyFiles[0]), 'utf8')).narration_scope === 'dialogue'; } catch {}
}
const normalizeAudio = !FORCE_COPY && !flag('--no-normalize-audio', false) && (dialogueStory || !!flag('--normalize-audio', false));
const mustEncode = REENCODE || normalizeAudio || (MISMATCH && !FORCE_COPY);
if (normalizeAudio) log('Dialogue loudness will be balanced per clip to -16 LUFS before joining.');
if (MISMATCH && FORCE_COPY) log('         --copy given: stream copy forced anyway. Expect a broken file.');

if (DRY_RUN) {
    log('');
    log('--dry-run: nothing written. Re-run without --dry-run to join.');
    process.exit(0);
}

// ── concat ------------------------------------------------------------------
// The concat DEMUXER (a list file) is used rather than the concat PROTOCOL,
// because the protocol re-muxes on the fly and is pickier about mismatched
// parameters. -safe 0 is required for absolute Windows paths.
const listPath = path.join(DIR, '_concat_list.txt');
// Entries MUST be absolute. ffmpeg resolves a relative entry against the list
// file's OWN folder - and the list lives inside DIR - so a DIR-relative entry
// gets DIR prepended twice and every clip "does not exist". The error ffmpeg
// prints names the LIST, not the entry, which sends you looking in the wrong
// place. Absolute paths are also why -safe 0 is needed above.
// Forward slashes: ffmpeg parses the list itself and treats backslashes as
// escapes. Single quotes inside a path are escaped by closing/escaping/reopening.
const listBody = ordered
    .map(f => path.resolve(DIR, f).replace(/\\/g, '/').replace(/'/g, "'\\''"))
    .map(p => `file '${p}'`)
    .join('\n') + '\n';
fs.writeFileSync(listPath, listBody, 'utf8');

const outPath = OUT_FLAG || path.join(path.dirname(path.resolve(DIR)),
    path.basename(path.resolve(DIR)) + (partialExport ? '_partial.mp4' : '_final.mp4'));
// Keep the last complete export playable while the replacement is encoding.
const workingPath = outPath.replace(/\.mp4$/i, '') + `.building_${process.pid}.mp4`;

banner('JOINING WITH FFMPEG');
log(`Output: ${outPath}`);

const copyArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', workingPath];
const audioFilters = normalizeAudio ? ordered.map(f => {
    if (!probes.get(f).acodec) return '';
    const { measureLoudness, loudnessFilter } = require('./audio_loudness');
    const measured = measureLoudness(path.resolve(DIR, f));
    log(`Audio ${f}: ${measured.input_i} LUFS -> -16 LUFS`);
    return loudnessFilter(measured);
}) : [];
const encArgs = require('./join_normalized').normalizedJoinArgs(
    ordered.map(f => path.resolve(DIR, f)), ordered.map(f => probes.get(f)), workingPath, { audioFilters });

function runFfmpeg(args, label) {
    log(`${label}: ffmpeg ${args.slice(0, 6).join(' ')} ...`);
    try {
        const out = execFileSync('ffmpeg', args, {
            encoding: 'utf8', timeout: 1800000, stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { ok: true, out };
    } catch (e) {
        // ffmpeg writes progress to stderr even on success, so the message is
        // only meaningful when the exit code is non-zero - which is here.
        const err = (e.stderr || e.message || '').toString();
        return { ok: false, err };
    }
}

let result;
if (mustEncode) {
    if (REENCODE) log('--reencode: stream copy skipped, encoding now (this is slower).');
    else log('Normalizing each clip BEFORE concatenation to preserve audio/video sync and the selected audio settings.');
    result = runFfmpeg(encArgs, 'encode');
} else {
    result = runFfmpeg(copyArgs, 'stream copy');
    if (!result.ok) {
        // The copy is free and instant, so always try it first; fall back rather
        // than making the caller guess at why.
        log('Stream copy refused - falling back to re-encode.');
        log(`  ffmpeg said: ${String(result.err).split('\n').filter(Boolean).slice(-6).join(' / ').slice(0, 500)}`);
        result = runFfmpeg(encArgs, 'encode');
    }
}

if (!result.ok) {
    console.error('\nJOIN FAILED.');
    console.error(String(result.err).split('\n').filter(Boolean).slice(-12).join('\n'));
    console.error(`\nThe list file is still there if you want to run ffmpeg by hand:\n  ${listPath}`);
    process.exit(1);
}

if (!fs.existsSync(workingPath)) {
    console.error('ffmpeg reported success but produced no file.');
    process.exit(1);
}

const outputProbe = probe(workingPath);
const finalDur = outputProbe?.duration ?? null;
if (!outputProbe?.vcodec || !(finalDur > 0) || total && Math.abs(finalDur - total) > 1.5) {
    console.error(`JOIN FAILED: encoded output failed duration/video validation. Previous final file was preserved. Recovery file: ${workingPath}`);
    process.exit(1);
}
try { fs.renameSync(workingPath, outPath); }
catch (e) {
    console.error(`The joined video is complete, but the final filename is open or unavailable. Close it in your player and use ${workingPath}. ${e.message}`);
    process.exit(1);
}
let start = 0;
const orderReport = ordered.map((file, i) => {
    const row = `${String(i + 1).padStart(2, '0')} | ${start.toFixed(2)}s | ${file}`;
    start += probes.get(file)?.videoDuration || probes.get(file)?.duration || 0;
    return row;
});
fs.writeFileSync(path.join(path.dirname(outPath), 'JOINED_CLIP_ORDER.txt'),
    `Completed video: ${outPath}\nOrder from: ${orderSource}\nStory position | Starts at | Source filename\n` + orderReport.join('\n') + '\n', 'utf8');

banner('DONE');
log(`File    : ${outPath}`);
log(`Size    : ${(fs.statSync(outPath).size / 1048576).toFixed(1)} MB`);
log(`Duration: ${finalDur != null ? finalDur.toFixed(2) + 's' : 'unknown'}`);
if (total && finalDur != null && Math.abs(finalDur - total) > 1.5) {
    log('');
    log(`WARNING: the joined duration differs from the sum of the clips by ${Math.abs(finalDur - total).toFixed(1)}s.`);
    log('         On a stream copy this usually means a clip was truncated. Watch the file.');
}
log(`Clips   : ${ordered.length} joined, in this order:`);
ordered.forEach((f, i) => log(`          ${String(i + 1).padStart(2, '0')}. ${f}`));
