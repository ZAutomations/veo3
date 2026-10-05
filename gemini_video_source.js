#!/usr/bin/env node
/**
 * GET A REFERENCE VIDEO IN FRONT OF GEMINI - TWO WAYS, NOT ONE
 * ===========================================================
 * A public YouTube link can be handed to Gemini as a `file_uri` and Google
 * fetches it server-side: no download, no upload, instant. That is the happy
 * path - and it was the ONLY path this project had. So whenever it did not get
 * through (503 "high demand", a video Google will not fetch, a private or
 * age-gated link, a URL shape it does not recognise) the analysis failed and
 * took the whole batch item down with it.
 *
 * The tool this was ported from does not depend on that path. It tries the
 * native link first and, when that does not work, downloads the video with
 * yt-dlp and uploads the BYTES to the Gemini Files API, then asks Gemini to
 * read the uploaded file. Different transport, different quota, different
 * failure modes - and it works for videos the native fetch refuses.
 *
 * An uploaded video is PROCESSING for a while, so the file is polled until it
 * is ACTIVE. Calling generateContent before that fails, which is why the poll
 * is not optional.
 *
 * Nothing here needs the google SDK: the REST shape is small and this keeps the
 * project's single dependency (puppeteer) intact.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FILES_API = 'https://generativelanguage.googleapis.com/v1beta';
const UPLOAD_API = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

// Gemini's own ceiling is 2GB. A 3-hour upload would be a slow, pointless wait
// for a pipeline that is reading a short-form reference, so refuse it early
// with a message that says why, rather than after twenty minutes.
const MAX_BYTES = 400 * 1024 * 1024;

function isYouTube(url) {
    return /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(String(url || ''));
}

// yt-dlp is a Python tool and may simply not be installed. Say so once, clearly,
// rather than throwing ENOENT from the middle of a download.
function ytDlpPath() {
    for (const cmd of ['yt-dlp', 'yt-dlp.exe']) {
        const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 20000 });
        if (!r.error && r.status === 0) return cmd;
    }
    return null;
}

// Kept pure so the argument list can be asserted without a network or a video.
//
// -f prefers a progressive mp4 under 720p: no ffmpeg merge step, which is both
// faster and one less thing to have installed. "b" alone is the last resort so
// an unusual video still downloads rather than erroring out.
function downloadArgs(url, outPath) {
    return [
        '-f', 'b[ext=mp4][height<=720]/b[height<=720]/b',
        '--no-playlist',        // a watch?v=..&list=.. link must not pull a whole playlist
        '--no-warnings',
        '--no-progress',
        '--max-filesize', '400M',
        '-o', outPath,
        url,
    ];
}

function looksLikeUrl(u) { return /^https?:\/\//i.test(String(u || '')); }

// ── download ────────────────────────────────────────────────────────────────
// Returns { path, bytes }. The caller owns the file and must delete it.
async function downloadVideo(url, opts = {}) {
    const log = opts.log || (() => {});
    const ytdlp = opts.ytDlp || ytDlpPath();
    if (!ytdlp) {
        throw new Error('yt-dlp is not installed or not on PATH - cannot download the video to upload it');
    }
    if (!looksLikeUrl(url)) throw new Error(`Not a downloadable URL: ${url}`);

    const dir = opts.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-ref-'));
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, 'source.%(ext)s');

    // Until a download succeeds there is nothing worth keeping in this folder,
    // and a failed one used to leave an empty mkdtemp directory behind on every
    // attempt - and the fallback can be attempted several times in one run.
    const cleanupDir = () => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    };

    // spawnSync is injectable so the post-processing below - finding what
    // yt-dlp actually wrote, and the size ceiling - can be tested without a
    // network or a real video.
    const spawn = opts.spawn || spawnSync;
    const r = spawn(ytdlp, downloadArgs(url, out), {
        encoding: 'utf8',
        timeout: opts.timeoutMs || 10 * 60 * 1000,
        maxBuffer: 8 * 1024 * 1024,
    });
    if (r.error) {
        cleanupDir();
        throw new Error(`yt-dlp could not run: ${r.error.message}`);
    }
    if (r.status !== 0) {
        const why = String(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ').slice(0, 300);
        cleanupDir();
        throw new Error(`yt-dlp failed (exit ${r.status}): ${why || 'no output'}`);
    }

    // -o with %(ext)s means the real name is only known after the fact.
    const made = fs.readdirSync(dir).filter((f) => f.startsWith('source.'));
    if (!made.length) {
        cleanupDir();
        throw new Error('yt-dlp reported success but wrote no file');
    }
    const file = path.join(dir, made[0]);
    const bytes = fs.statSync(file).size;
    if (bytes > MAX_BYTES) {
        cleanupDir();
        throw new Error(`the video is ${(bytes / 1048576).toFixed(0)}MB, over the ${MAX_BYTES / 1048576}MB limit for an upload`);
    }
    log(`downloaded ${(bytes / 1048576).toFixed(1)}MB`);
    return { path: file, bytes, dir, cleanupDir };
}

// ── upload ──────────────────────────────────────────────────────────────────
const MIME_BY_EXT = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
    '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
};
function mimeFor(file) {
    return MIME_BY_EXT[path.extname(String(file || '')).toLowerCase()] || 'video/mp4';
}

// The Files API is a two-step resumable upload: `start` returns a session URL
// in a header, then the bytes go to that URL with `upload, finalize`.
async function uploadFile(key, filePath, opts = {}) {
    const fetchImpl = opts.fetch || fetch;
    const timeout = opts.timeoutMs || 20 * 60 * 1000;
    const bytes = fs.statSync(filePath).size;
    const mime = opts.mimeType || mimeFor(filePath);
    const name = path.basename(filePath);

    const start = await fetchImpl(UPLOAD_API, {
        method: 'POST',
        headers: {
            'x-goog-api-key': key,
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(bytes),
            'X-Goog-Upload-Header-Content-Type': mime,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: name } }),
        signal: AbortSignal.timeout(timeout),
    });
    if (!start.ok) throw await httpError(start, 'starting the upload');

    const sessionUrl = start.headers.get('x-goog-upload-url');
    if (!sessionUrl) throw new Error('the upload session URL was missing from the response headers');

    const done = await fetchImpl(sessionUrl, {
        method: 'POST',
        headers: {
            'Content-Length': String(bytes),
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize',
        },
        body: fs.readFileSync(filePath),
        signal: AbortSignal.timeout(timeout),
    });
    if (!done.ok) throw await httpError(done, 'uploading the video');
    const file = (await done.json()).file;
    if (!file || !file.uri) throw new Error('the upload returned no file uri');
    return { name: file.name, uri: file.uri, mimeType: file.mimeType || mime, state: file.state, bytes };
}

async function httpError(res, doing) {
    let msg = `HTTP ${res.status}`;
    try {
        const j = await res.json();
        if (j && j.error && j.error.message) msg = `${res.status} ${j.error.message}`;
    } catch (e) { /* not json */ }
    const err = new Error(`${msg} (while ${doing})`);
    err.status = res.status;
    return err;
}

// ── wait for the file to be readable ────────────────────────────────────────
// A video is PROCESSING briefly after upload. generateContent against a file
// that is not ACTIVE yet fails, so this is a real wait, not a formality.
async function waitForActive(key, name, opts = {}) {
    const fetchImpl = opts.fetch || fetch;
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = opts.now || (() => Date.now());
    const log = opts.log || (() => {});
    const deadline = now() + (opts.budgetMs !== undefined ? opts.budgetMs : 5 * 60 * 1000);
    let wait = 1500;

    for (;;) {
        const res = await fetchImpl(`${FILES_API}/${name}`, {
            headers: { 'x-goog-api-key': key },
            signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) throw await httpError(res, 'checking the uploaded file');
        const f = await res.json();
        if (f.state === 'ACTIVE') return f;
        if (f.state === 'FAILED') throw new Error(`Gemini could not process the uploaded video (state FAILED)`);
        if (now() >= deadline) {
            throw new Error(`the uploaded video was still ${f.state || 'PROCESSING'} after ` +
                `${Math.round((opts.budgetMs !== undefined ? opts.budgetMs : 300000) / 1000)}s`);
        }
        log(`upload is ${f.state || 'PROCESSING'} - waiting...`);
        await sleep(wait);
        wait = Math.min(wait * 2, 10000);   // 1.5s, 3s, 6s, then every 10s
    }
}

// Best effort: a file left on Google's side costs the account storage quota.
async function removeFile(key, name, opts = {}) {
    if (!name) return false;
    const fetchImpl = opts.fetch || fetch;
    try {
        const res = await fetchImpl(`${FILES_API}/${name}`, {
            method: 'DELETE',
            headers: { 'x-goog-api-key': key },
            signal: AbortSignal.timeout(30000),
        });
        return res.ok;
    } catch (e) { return false; }
}

// ── the whole fallback, as one call ─────────────────────────────────────────
// Returns { file_uri, mime_type, bytes, cleanup() }. `cleanup` removes both the
// local download and the remote file, and never throws.
async function videoSource(url, key, opts = {}) {
    const log = opts.log || (() => {});
    const dl = await downloadVideo(url, opts);
    let uploaded = null;
    try {
        log('uploading to Gemini...');
        uploaded = await uploadFile(key, dl.path, opts);
        const ready = await waitForActive(key, uploaded.name, opts);
        return {
            file_uri: ready.uri || uploaded.uri,
            mime_type: ready.mimeType || uploaded.mimeType,
            bytes: dl.bytes,
            name: uploaded.name,
            async cleanup() {
                await removeFile(key, uploaded.name, opts);
                try { fs.rmSync(dl.dir, { recursive: true, force: true }); } catch (e) { /* gone */ }
            },
        };
    } catch (e) {
        // Do not leak either copy when the upload or the wait fails.
        if (uploaded && uploaded.name) await removeFile(key, uploaded.name, opts);
        try { fs.rmSync(dl.dir, { recursive: true, force: true }); } catch (e2) { /* gone */ }
        throw e;
    }
}

module.exports = {
    isYouTube, ytDlpPath, downloadArgs, downloadVideo, uploadFile, waitForActive,
    removeFile, videoSource, mimeFor, looksLikeUrl, MAX_BYTES, FILES_API, UPLOAD_API,
};
