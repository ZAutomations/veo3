// Tests for gemini_video_source.js - the download + upload fallback.
//
// The point of that module is that it must work when the native YouTube path
// does not, so what is worth testing is the shape of the two-step resumable
// upload, the poll state machine, and the cleanup - all driven here against a
// stubbed fetch and a stubbed spawn. No network, no yt-dlp, no real video.
//
// Run: node test_gemini_video_source.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('./gemini_video_source.js');
const W = require('./write_story.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 220) : ''}`); }
}

// ── which links can take this route ─────────────────────────────────────────
console.log('\n--- only YouTube links have a native path to fall back FROM ---');
ok('a shorts link', V.isYouTube('https://www.youtube.com/shorts/-kq83ncuXKc'));
ok('a watch link', V.isYouTube('https://youtube.com/watch?v=PwmHomYliKI'));
ok('a short youtu.be link', V.isYouTube('https://youtu.be/PwmHomYliKI'));
ok('a mobile link', V.isYouTube('https://m.youtube.com/watch?v=x'));
ok('with a scheme missing it is not a URL', !V.looksLikeUrl('www.youtube.com/watch?v=x'));
ok('vimeo is not YouTube', !V.isYouTube('https://vimeo.com/12345'));
ok('a lookalike domain is not YouTube', !V.isYouTube('https://notyoutube.com/watch?v=x'));
ok('empty is safe', !V.isYouTube('') && !V.isYouTube(null));

console.log('\n--- download arguments ---');
const args = V.downloadArgs('https://youtu.be/abc', 'C:/tmp/source.%(ext)s');
ok('prefers a progressive mp4 so no ffmpeg merge is needed',
    args.includes('-f') && /b\[ext=mp4\]\[height<=720\]/.test(args[args.indexOf('-f') + 1]),
    args[args.indexOf('-f') + 1]);
ok('falls back to any mp4-ish stream rather than failing',
    args[args.indexOf('-f') + 1].split('/').length >= 3, args[args.indexOf('-f') + 1]);
ok('refuses to walk a playlist', args.includes('--no-playlist'));
ok('caps the download size', args.includes('--max-filesize'));
ok('writes where it was told', args[args.indexOf('-o') + 1] === 'C:/tmp/source.%(ext)s');
ok('the url comes last', args[args.length - 1] === 'https://youtu.be/abc');
ok('the max size is under Gemini 2GB ceiling', V.MAX_BYTES <= 2 * 1024 * 1024 * 1024);

console.log('\n--- mime type is derived from the file, mp4 by default ---');
ok('mp4', V.mimeFor('a.mp4') === 'video/mp4');
ok('webm', V.mimeFor('a.webm') === 'video/webm');
ok('mov', V.mimeFor('a.mov') === 'video/quicktime');
ok('unknown extension falls back to mp4', V.mimeFor('a.xyz') === 'video/mp4');
ok('no extension is safe', V.mimeFor('') === 'video/mp4');

// ── the two-step resumable upload ───────────────────────────────────────────
console.log('\n--- upload: start, then finalize the bytes ---');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-test-'));
const videoFile = path.join(tmpDir, 'source.mp4');
fs.writeFileSync(videoFile, Buffer.alloc(2048, 7));

function stubFetch(handler) {
    const calls = [];
    const f = async (url, init) => {
        calls.push({ url, init });
        const r = handler(url, init, calls.length);
        return {
            ok: r.status >= 200 && r.status < 300,
            status: r.status,
            headers: { get: (h) => (r.headers || {})[h.toLowerCase()] || null },
            json: async () => r.body || {},
            text: async () => JSON.stringify(r.body || {}),
        };
    };
    return { f, calls };
}

(async () => {
    const up = stubFetch((url, init, n) => {
        if (n === 1) {
            return { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/session/1' } };
        }
        return {
            status: 200,
            body: { file: { name: 'files/abc123', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123', mimeType: 'video/mp4', state: 'PROCESSING' } },
        };
    });
    const res = await V.uploadFile('KEY1', videoFile, { fetch: up.f });

    ok('two requests were made', up.calls.length === 2, String(up.calls.length));
    const start = up.calls[0];
    ok('the first is the resumable start', start.init.headers['X-Goog-Upload-Protocol'] === 'resumable');
    ok('and asks for a start, not an upload', start.init.headers['X-Goog-Upload-Command'] === 'start');
    ok('it declares the exact byte length',
        start.init.headers['X-Goog-Upload-Header-Content-Length'] === '2048',
        start.init.headers['X-Goog-Upload-Header-Content-Length']);
    ok('and the mime type, so Gemini does not have to guess',
        start.init.headers['X-Goog-Upload-Header-Content-Type'] === 'video/mp4');
    ok('it names the file for the operator',
        JSON.parse(start.init.body).file.display_name === 'source.mp4', start.init.body);

    const fin = up.calls[1];
    ok('the second posts to the session URL from the header',
        fin.url === 'https://upload.example/session/1', fin.url);
    ok('at offset 0', fin.init.headers['X-Goog-Upload-Offset'] === '0');
    ok('finalizing in one shot', fin.init.headers['X-Goog-Upload-Command'] === 'upload, finalize');
    ok('carrying the raw bytes, not a path', Buffer.isBuffer(fin.init.body) && fin.init.body.length === 2048);
    ok('the uri is returned for the generateContent call',
        res.uri.endsWith('/files/abc123'), res.uri);
    ok('and the mime type', res.mimeType === 'video/mp4');

    // A missing session URL must be an error, not a silent upload to undefined.
    const noSession = stubFetch(() => ({ status: 200, headers: {} }));
    let threw = null;
    try { await V.uploadFile('K', videoFile, { fetch: noSession.f }); } catch (e) { threw = e; }
    ok('a missing session URL fails loudly', !!threw && /session URL/.test(threw.message), String(threw && threw.message));

    // A rejected key must surface with its status, so the ring can rotate.
    const denied = stubFetch(() => ({ status: 403, body: { error: { message: 'API key not valid' } } }));
    let threw403 = null;
    try { await V.uploadFile('K', videoFile, { fetch: denied.f }); } catch (e) { threw403 = e; }
    ok('a 403 carries its status for key rotation', threw403 && threw403.status === 403, String(threw403 && threw403.status));
    ok('and says what it was doing', /starting the upload/.test(threw403.message), threw403.message);

    // ── the poll ────────────────────────────────────────────────────────────
    console.log('\n--- upload poll: PROCESSING is not ready ---');
    let t = 0;
    const waits = [];
    let n = 0;
    const poll = stubFetch(() => {
        n++;
        return { status: 200, body: { name: 'files/x', uri: 'u', mimeType: 'video/mp4', state: n < 3 ? 'PROCESSING' : 'ACTIVE' } };
    });
    const ready = await V.waitForActive('K', 'files/x', {
        fetch: poll.f,
        sleep: async (ms) => { waits.push(ms); t += ms; },
        now: () => t,
        log: () => {},
    });
    ok('it waits until ACTIVE', ready.state === 'ACTIVE');
    ok('polling three times', poll.calls.length === 3, String(poll.calls.length));
    ok('and backing off rather than hammering', waits[0] === 1500 && waits[1] === 3000, waits.join(','));
    ok('the key travels in a header, never the URL',
        poll.calls[0].init.headers['x-goog-api-key'] === 'K' && !/KEY/.test(poll.calls[0].url));

    // FAILED is terminal: retrying it would just burn the budget.
    let failed = null;
    try {
        await V.waitForActive('K', 'files/x', {
            fetch: stubFetch(() => ({ status: 200, body: { state: 'FAILED' } })).f,
            sleep: async () => {}, now: () => 0, log: () => {},
        });
    } catch (e) { failed = e; }
    ok('a FAILED upload stops immediately', !!failed && /FAILED/.test(failed.message), String(failed && failed.message));

    // A file that never becomes ready must give up inside its budget.
    let t2 = 0;
    let stuck = null;
    try {
        await V.waitForActive('K', 'files/x', {
            fetch: stubFetch(() => ({ status: 200, body: { state: 'PROCESSING' } })).f,
            sleep: async (ms) => { t2 += ms; }, now: () => t2, log: () => {}, budgetMs: 30000,
        });
    } catch (e) { stuck = e; }
    ok('a file stuck in PROCESSING times out', !!stuck && /still PROCESSING/.test(stuck.message), String(stuck && stuck.message));
    ok('after roughly the budget', t2 >= 30000 && t2 <= 30000 + 10000, String(t2));

    // ── cleanup ─────────────────────────────────────────────────────────────
    console.log('\n--- cleanup frees both copies ---');
    const del = stubFetch(() => ({ status: 200, body: {} }));
    ok('removing a file reports success', await V.removeFile('K', 'files/x', { fetch: del.f }) === true);
    ok('and uses DELETE', del.calls[0].init.method === 'DELETE', del.calls[0].init.method);
    ok('a missing name is a no-op', await V.removeFile('K', '', { fetch: del.f }) === false);
    const boom = stubFetch(() => { throw new Error('network down'); });
    ok('a failed delete returns false instead of throwing',
        await V.removeFile('K', 'files/x', { fetch: boom.f }) === false);

    // ── the whole fallback, with a stubbed downloader ───────────────────────
    console.log('\n--- videoSource: download, upload, wait, clean up ---');
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-test2-'));
    const fakeSpawn = (cmd, a) => {
        // Stand in for yt-dlp writing what -o asked for.
        const outTemplate = a[a.indexOf('-o') + 1];
        fs.writeFileSync(outTemplate.replace('%(ext)s', 'mp4'), Buffer.alloc(4096, 1));
        return { status: 0, stdout: '', stderr: '' };
    };
    const srcFetch = stubFetch((url, init) => {
        const u = String(url);
        if (u.includes('/upload/')) {
            return { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/s' } };
        }
        if (u === 'https://upload.example/s') {
            return { status: 200, body: { file: { name: 'files/z', uri: 'https://gl/files/z', mimeType: 'video/mp4', state: 'PROCESSING' } } };
        }
        if (init && init.method === 'DELETE') return { status: 200, body: {} };
        // The poll: ready on the first look.
        return { status: 200, body: { name: 'files/z', state: 'ACTIVE', uri: 'https://gl/files/z', mimeType: 'video/mp4' } };
    });
    // A clock that actually advances, or the poll's deadline never arrives and
    // the loop spins until the heap runs out.
    let vt = 0;
    const src = await V.videoSource('https://youtu.be/abc', 'K', {
        fetch: srcFetch.f, spawn: fakeSpawn, dir: dir2, log: () => {},
        sleep: async (ms) => { vt += ms; }, now: () => vt,
    });
    ok('it yields a file_uri for generateContent', src.file_uri === 'https://gl/files/z', src.file_uri);
    ok('with the mime type', src.mime_type === 'video/mp4');
    ok('and the size, for the log', src.bytes === 4096, String(src.bytes));
    await src.cleanup();
    ok('the remote file is deleted', srcFetch.calls.some((c) => c.init && c.init.method === 'DELETE'));
    ok('the local temp directory is gone', !fs.existsSync(dir2), 'still there');

    // A download that fails must not leave the temp dir behind.
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-test3-'));
    let dlFail = null;
    try {
        await V.videoSource('https://youtu.be/abc', 'K', {
            fetch: srcFetch.f,
            spawn: () => ({ status: 1, stdout: '', stderr: 'ERROR: Video unavailable' }),
            dir: dir3, log: () => {},
        });
    } catch (e) { dlFail = e; }
    ok('a failed download throws', !!dlFail, String(dlFail && dlFail.message));
    ok('and says what yt-dlp said', /Video unavailable/.test(dlFail.message), dlFail.message);
    ok('without leaving the temp directory', !fs.existsSync(dir3));

    // An upload that fails must clean up too - both copies.
    const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-test4-'));
    const badUpload = stubFetch(() => ({ status: 500, body: { error: { message: 'backend error' } } }));
    let upFail = null;
    try {
        await V.videoSource('https://youtu.be/abc', 'K', { fetch: badUpload.f, spawn: fakeSpawn, dir: dir4, log: () => {} });
    } catch (e) { upFail = e; }
    ok('an upload failure throws', !!upFail, String(upFail && upFail.message));
    ok('and the temp directory is cleaned up', !fs.existsSync(dir4));

    // ── refusing what cannot work ───────────────────────────────────────────
    console.log('\n--- refusing what cannot work ---');
    let noBin = null;
    try { await V.downloadVideo('https://youtu.be/a', { ytDlp: 'definitely-not-a-real-binary-xyz' }); }
    catch (e) { noBin = e; }
    ok('a missing yt-dlp is reported clearly', !!noBin && /could not run/.test(noBin.message), String(noBin && noBin.message));

    let notUrl = null;
    try { await V.downloadVideo('not a url', { ytDlp: process.execPath }); } catch (e) { notUrl = e; }
    ok('a non-URL is refused before spawning', !!notUrl && /Not a downloadable/.test(notUrl.message), String(notUrl && notUrl.message));

    // ── the pipeline is actually wired to the fallback ──────────────────────
    console.log('\n--- analyze_video.js uses it ---');
    const av = fs.readFileSync(path.join(__dirname, 'analyze_video.js'), 'utf8');
    ok('analyze_video requires the module', /require\('\.\/gemini_video_source\.js'\)/.test(av));
    ok('and calls videoSource when the link alone fails', /V\.videoSource\(/.test(av));
    ok('passing the uploaded file into the retry loop', /file:\s*\{\s*file_uri:\s*src\.file_uri/.test(av));
    ok('and always cleaning up the upload', /src\.cleanup\(\)/.test(av));
    ok('with a flag to turn the fallback off', /--no-download/.test(av));

    // askVideo must honour an injected file, or the fallback would silently
    // re-send the native link and fail again for the same reason.
    ok('askVideo sends opts.file when given one',
        /file_data:\s*opts\.file\s*\|\|\s*\{\s*file_uri:\s*URL\s*\}/.test(av),
        'file_data line');

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + (e && e.stack || e)); process.exit(1); });
