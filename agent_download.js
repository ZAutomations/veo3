#!/usr/bin/env node
/**
 * FLOW AGENT MODE - CLIP DOWNLOADER
 * ==================================
 * Pulls the generated clips out of a Flow project into a local folder, ready
 * for join_clips.js.
 *
 * WHY THIS IS PROBE-FIRST. The per-tile DOM is only half known. A snapshot taken
 * after a real generation (logs/agent_run_2026-09-11T11-21-07) shows the project
 * grid carries, per tile, exactly three buttons:
 *
 *     button[aria-label="Favorite"]
 *     button[aria-label="Reuse prompt"]
 *     button[aria-label="More options"]     <- mat-mdc-menu-trigger
 *
 * and that five video tiles = five such sets, in DOM order. So "More options"
 * is the download route - but what that menu CONTAINS has never been recorded,
 * and neither has whether the tile exposes a plain <video src>. Rather than
 * hard-code a guess that fails silently, this script:
 *
 *   1. always dumps every tile's full inner DOM to logs/ before touching it
 *   2. tries the DIRECT route first (read <video>.src, fetch the bytes) because
 *      it needs no menus and cannot mis-order anything
 *   3. falls back to the More options -> Download menu route
 *   4. refuses to guess the file order - it writes manifest.json recording
 *      exactly which tile became which file, and prints the mapping
 *
 * Run --probe on the first run against a real project. It clicks nothing and
 * tells you which route this project actually supports.
 *
 * ORDER IS NOT OBVIOUS. Flow's grid is usually NEWEST FIRST, so DOM order is
 * often the reverse of scene order. This script does not silently "fix" that.
 * It numbers files by on-screen order (left-to-right, top-to-bottom), records
 * DOM order separately in the manifest, and prints the mapping so it can be
 * checked. join_clips.js then joins in manifest order, with --reverse available.
 *
 * Usage:
 *   node agent_download.js --probe
 *   node agent_download.js --out "stories/the_gift_of_honesty/clips"
 *   node agent_download.js --out DIR --method src      (direct only)
 *   node agent_download.js --out DIR --method menu     (menu only)
 *   node agent_download.js --out DIR --reverse         (number newest-first)
 *
 * Flags:
 *   --cdp N        CDP port (default 9222)
 *   --out DIR      where to write the .mp4 files (default <cwd>/clips)
 *   --probe        inspect and dump only; download nothing
 *   --method X     auto (default) | src | menu
 *   --reverse      number the files in reverse DOM order
 *   --limit N      stop after N tiles
 *   --no-sheet     skip the contact sheet (see below)
 *   --settle MS    wait after opening a menu (default 2500)
 *
 * THE CONTACT SHEET. A tile carries no name - only "play_circle" - so once the
 * clips are on disk there is nothing left to check the scene order against, and
 * a wrong order produces a perfectly valid video with the scenes shuffled. So
 * every download also writes _contact_sheet.jpg: one frame of each clip, each
 * stamped with its clip number and tiled in order. Open it, and the numbering is
 * either right or wrong in one glance. Disable with --no-sheet.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isVideoRecord, isFailedRecord, selectStoryClips } = require('./download_tile_logic');
const { createHash } = require('crypto');
const { hasVideoContainer, playableVideo } = require('./download_media_validation');
const { downloadFlowAsset } = require('./flow_asset_download');

const wait = (ms) => new Promise(r => setTimeout(r, ms));
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

const CDP_PORT = flag('--cdp', '9222');
const CDP_URL  = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR  = typeof flag('--out') === 'string' ? flag('--out') : path.join(process.cwd(), 'clips');
const PROBE    = !!flag('--probe', false);
const METHOD   = (typeof flag('--method') === 'string' ? flag('--method') : 'auto').toLowerCase();
const REVERSE  = !!flag('--reverse', false);
const LIMIT    = parseInt(flag('--limit', '0'), 10) || 0;
const SETTLE   = parseInt(flag('--settle', '2500'), 10);
const SHEET    = !flag('--no-sheet', false);
const EXPECTED = parseInt(flag('--expected', '0'), 10) || 0;
const STORY_FILE = typeof flag('--story') === 'string' ? flag('--story') : null;
// --sheet-only <dir>: rebuild the contact sheet from clips already on disk, with
// no browser and no re-download. Lets the join order be re-checked after the fact.
const SHEET_ONLY = typeof flag('--sheet-only') === 'string' ? flag('--sheet-only') : null;

const RUN_ID  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RUN_DIR = path.join(__dirname, 'logs', `agent_download_${RUN_ID}`);

// ── in-page: inventory the project grid --------------------------------------
// Scoped deliberately: every field is read from inside ONE tile, so the "More
// options" button we later click provably belongs to that tile and not to a
// neighbour. Clicking a global nth button would be a coin flip.
function inventoryFn() {
    const cls = (el) => (el.className && el.className.toString) ? el.className.toString() : '';
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

    const tileSel = 'flow-video-tile, flow-image-tile, [class*="video-tile"], [class*="media-tile"]';
    let tiles = [...document.querySelectorAll(tileSel)].filter(vis);
    // If the named elements are absent, fall back to any element that owns a
    // "More options" trigger - that is the per-tile menu and therefore a tile.
    if (!tiles.length) {
        tiles = [...document.querySelectorAll('button[aria-label="More options"]')]
            .filter(vis)
            .map(b => { let p = b; for (let i = 0; i < 8 && p.parentElement; i++) { p = p.parentElement; if (p.querySelector('video, img')) break; } return p; })
            .filter((el, i, a) => el && a.indexOf(el) === i);
    }

    const scroller = document.querySelector('.cdk-virtual-scrollable.page-container, .page-container');
    const sr = scroller ? scroller.getBoundingClientRect() : { x: 0, y: 0 };
    const sy = scroller ? scroller.scrollTop : window.scrollY;
    const sx = scroller ? scroller.scrollLeft : window.scrollX;
    const out = tiles.map((t, i) => {
        const r = t.getBoundingClientRect();
        const vids = [...t.querySelectorAll('video')];
        const imgs = [...t.querySelectorAll('img')];
        const btns = [...t.querySelectorAll('button')].map(b => ({
            aria: b.getAttribute('aria-label'),
            text: (b.innerText || '').trim().slice(0, 40),
            cls: cls(b).slice(0, 90),
        }));
        // Longest-line rule for the caption - see the hover-pass comment above
        // for why. Kept in sync by hand because this half runs inside the page.
        const lines = (t.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
        const caption = lines.length ? lines.sort((a, b) => b.length - a.length)[0].slice(0, 120) : '';
        const tag = t.tagName.toLowerCase();
        const mediaUrl = vids.map(v => v.getAttribute('src')).find(Boolean)
            || imgs.map(im => im.getAttribute('src')).find(Boolean) || '';
        const assetId = (mediaUrl.match(/\/(?:video|image|asb)\/([^=?/#]+)/) || [])[1] || null;
        const batch = t.closest('.batch-container');
        const tileText = (t.innerText || t.textContent || '').trim();
        const failed = /audio generation failed|failed to generate|generation failed|something went wrong|try a different prompt|you have not been charged/i.test(tileText)
            || btns.some(b => /^retry$/i.test(String(b.aria || '').trim()));
        return {
            index: i,
            gridY: Math.round(sy + r.y - sr.y),
            gridX: Math.round(sx + r.x - sr.x),
            tag,
            assetId,
            prompt: batch && batch.querySelectorAll('flow-video-tile').length === 1 ? batch.innerText : '',
            // The tag identifies the asset. Off-screen video tiles often have
            // only an image preview because Flow unmounts their <video> child.
            isVideoTile: tag === 'flow-video-tile' || vids.length > 0,
            cls: cls(t).slice(0, 140),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            // Every plausible identity signal, so the order question can be
            // settled from the dump instead of guessed at now.
            aria: t.getAttribute('aria-label'),
            title: t.getAttribute('title'),
            dataAttrs: [...t.attributes].filter(a => /^data-/.test(a.name)).map(a => `${a.name}=${a.value}`).slice(0, 12),
            text: tileText.slice(0, 200),
            failed,
            caption,
            videoCount: vids.length,
            videoSrcs: vids.map(v => ({ src: v.getAttribute('src'), currentSrc: v.currentSrc || null, poster: v.getAttribute('poster'), dur: Number.isFinite(v.duration) ? v.duration : null })).slice(0, 3),
            imgSrcs: imgs.map(im => im.getAttribute('src') || '').slice(0, 3),
            buttons: btns,
            hasMoreOptions: !!t.querySelector('button[aria-label="More options"]'),
        };
    });

    // Visual order: top-to-bottom, then left-to-right. Grid layout wraps rows, so
    // sorting purely by y then x reconstructs what the eye sees.
    const visual = [...out].sort((a, b) => (Math.abs(a.rect.y - b.rect.y) > 20)
        ? a.rect.y - b.rect.y
        : a.rect.x - b.rect.x);

    return { url: location.href, tileCount: out.length, tiles: out, visualOrder: visual.map(t => t.index) };
}

// ── in-page: read a tile's video source --------------------------------------
function srcFn(idx) {
    const tileSel = 'flow-video-tile, flow-image-tile, [class*="video-tile"], [class*="media-tile"]';
    let tiles = [...document.querySelectorAll(tileSel)].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!tiles.length) {
        tiles = [...document.querySelectorAll('button[aria-label="More options"]')]
            .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
            .map(b => { let p = b; for (let i = 0; i < 8 && p.parentElement; i++) { p = p.parentElement; if (p.querySelector('video, img')) break; } return p; })
            .filter((el, i, a) => el && a.indexOf(el) === i);
    }
    const t = tiles[idx];
    if (!t) return { ok: false, why: 'tile missing' };
    const v = t.querySelector('video');
    if (!v) return { ok: false, why: 'no <video> in tile' };
    const src = v.currentSrc || v.getAttribute('src') || (v.querySelector('source') || {}).src || null;
    if (!src) return { ok: false, why: '<video> has no src' };
    return { ok: true, src, kind: src.startsWith('blob:') ? 'blob' : 'url' };
}

// Fetch the bytes from INSIDE the page, so a blob: URL or an authenticated CDN
// URL both work - the page's own cookies and blob registry are in scope, which
// they are not from Node. Returned base64 because a puppeteer evaluate result
// must be JSON-serialisable.
async function fetchB64Fn(url) {
    // Wrapped because this runs inside page.evaluate: a rejected promise there
    // does not come back as a value, it throws out of the evaluate call and
    // kills the whole run. A cross-origin fetch rejects with "Failed to fetch",
    // so without this the very first clip aborts everything.
    try {
        const r = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(30000) });
        if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
        if (/text\/html|application\/json|image\//i.test(r.headers.get('content-type') || '')) {
            return { ok: false, why: 'Server returned a sign-in page, error or image instead of video.' };
        }
        const buf = await r.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const CHUNK = 0x8000;                  // avoid blowing the arg limit
        for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return { ok: true, b64: btoa(binary), bytes: bytes.length };
    } catch (e) {
        return { ok: false, why: String((e && e.message) || e).slice(0, 120) };
    }
}

// The in-page fetch above is the natural one to try - but the clips live on
// flow-content.google, a DIFFERENT origin from flow.google.com, and that fetch
// dies with "Failed to fetch" the moment the CDN omits CORS headers. Measured
// live: it does. So the fallback pulls the bytes in NODE instead, where no CORS
// policy applies.
//
// The URL is signed (`Expires` + `KeyName` + `Signature`), so it usually needs
// no credential at all. Cookies for the CDN origin are still forwarded when the
// browser has them, because the signature may be scoped to the session - and
// passing them costs nothing when it is not.
async function fetchFromNode(url, cookieHeader, userAgent) {
    const headers = {
        'User-Agent': userAgent || 'Mozilla/5.0',
        'Referer': 'https://flow.google.com/',
        'Accept': '*/*',
    };
    if (cookieHeader) headers['Cookie'] = cookieHeader;
    try {
        const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(90000) });
        if (!r.ok) return { ok: false, why: `HTTP ${r.status} ${r.statusText || ''}`.trim() };
        const buf = Buffer.from(await r.arrayBuffer());
        if (!hasVideoContainer(buf)) return { ok: false, why: 'Server returned non-video bytes (possibly Google sign-in HTML).' };
        return { ok: true, buf };
    } catch (e) {
        return { ok: false, why: e.message };
    }
}

// ── in-page: open one tile's menu --------------------------------------------
function openMenuFn(idx) {
    const tileSel = 'flow-video-tile, flow-image-tile, [class*="video-tile"], [class*="media-tile"]';
    let tiles = [...document.querySelectorAll(tileSel)].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!tiles.length) {
        tiles = [...document.querySelectorAll('button[aria-label="More options"]')]
            .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
            .map(b => { let p = b; for (let i = 0; i < 8 && p.parentElement; i++) { p = p.parentElement; if (p.querySelector('video, img')) break; } return p; })
            .filter((el, i, a) => el && a.indexOf(el) === i);
    }
    const t = tiles[idx];
    if (!t) return { ok: false, why: 'tile missing' };
    // Scoped to THIS tile - a global nth match would click a neighbour's menu.
    let btn = t.querySelector('button[aria-label="More options"]');
    if (!btn) {
        // The triggers sometimes live in a sibling overlay wrapper rather than
        // inside the tile element itself.
        const wrap = t.closest('[class*="tile"], li, [role="gridcell"]') || t.parentElement;
        if (wrap) btn = wrap.querySelector('button[aria-label="More options"]');
    }
    if (!btn) {
        // Last resort: the nth global trigger, valid only if counts line up.
        const all = [...document.querySelectorAll('button[aria-label="More options"]')]
            .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        if (all.length === tiles.length) btn = all[idx];
        else return { ok: false, why: `no scoped More options (global=${all.length} tiles=${tiles.length})` };
    }
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return { ok: true };
}

// ── in-page: read the open menu ----------------------------------------------
function menuFn() {
    const cls = (el) => (el.className && el.className.toString) ? el.className.toString() : '';
    const root = document.querySelector('.cdk-overlay-container');
    if (!root || !root.children.length) return { open: false };
    const items = [...root.querySelectorAll('[role="menuitem"], button, mat-option, li, a')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map(el => {
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName.toLowerCase(),
                cls: cls(el).slice(0, 110),
                aria: el.getAttribute('aria-label'),
                text: (el.innerText || el.textContent || '').trim().slice(0, 80),
                cx: Math.round(r.x + r.width / 2),
                cy: Math.round(r.y + r.height / 2),
            };
        })
        .filter(el => el.text || el.aria);
    return { open: true, items, text: (root.innerText || '').slice(0, 600) };
}

// ── contact sheet: make the ORDER verifiable at a glance ---------------------
// The project grid gives a tile no name - only "play_circle". So once the clips
// are downloaded there is nothing left to check the scene order against except
// watching the joined video, which for 12 clips is a miserable way to find out
// that scene 1 is last. This burns the clip's own number into a frame of it and
// tiles them into one image: open it, and the order is either right or it isn't,
// in one glance.
//
// The font is COPIED next to the thumbnails and referenced relatively. ffmpeg's
// filter parser splits options on ':', so an absolute Windows font path
// (C:\Windows\...) has to be escaped into oblivion, and the fontconfig
// alternative (`drawtext=font=Arial`) segfaults on builds without a fontconfig
// config file. A relative path sidesteps both.
function buildSheet(outDir, clipFiles, runDir) {
    const fontSrc = ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\segoeui.ttf']
        .find(f => fs.existsSync(f));
    const thumbDir = path.join(runDir, 'thumbs');
    fs.rmSync(thumbDir, { recursive: true, force: true });
    fs.mkdirSync(thumbDir, { recursive: true });
    if (fontSrc) fs.copyFileSync(fontSrc, path.join(thumbDir, 'label.ttf'));

    const made = [];
    for (let i = 0; i < clipFiles.length; i++) {
        const n = String(i + 1).padStart(2, '0');
        // The drawn label is the TRUE clip number, but the FILENAME is a gapless
        // sequence: the image2 demuxer below reads thumb-%02d.jpg and stops at the
        // first missing number, so one failed frame must not punch a hole in it.
        const seq = String(made.length + 1).padStart(2, '0');
        const out = `thumb-${seq}.jpg`;
        // 1s in is safely past any fade-from-black; fall back for very short clips.
        const filters = [
            'scale=320:-1',
            fontSrc ? `drawtext=fontfile=label.ttf:text='${n}':x=8:y=8:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.65` : null,
        ].filter(Boolean).join(',');

        let done = false;
        for (const ss of ['1', '0.4', '0']) {
            try {
                // INPUT MUST BE ABSOLUTE: cwd is thumbDir below, so a relative
                // outDir resolves INSIDE the thumbs folder and every frame fails,
                // which is indistinguishable from "ffmpeg is missing".
                execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', ss,
                    '-i', path.resolve(outDir, clipFiles[i]),
                    '-frames:v', '1', '-vf', filters, out],
                    { cwd: thumbDir, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
                done = true;
                break;
            } catch { /* try the next timestamp */ }
        }
        if (done) made.push(out);
    }

    if (!made.length) return null;

    // 12 clips -> 4x3, which is the common case for a 12-scene story.
    const cols = made.length <= 4 ? made.length : (made.length <= 9 ? 3 : 4);
    const rows = Math.ceil(made.length / cols);
    const sheet = path.join(outDir, '_contact_sheet.jpg');
    try {
        execFileSync('ffmpeg', ['-y', '-v', 'error',
            '-i', 'thumb-%02d.jpg', '-vf', `tile=${cols}x${rows}`, path.resolve(sheet)],
            { cwd: thumbDir, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        return null;
    }
    return fs.existsSync(sheet) ? sheet : null;
}

// ── --sheet-only: rebuild the sheet without touching the browser -------------
// Order comes from manifest.json when it is there, because that is the SAME
// source join_clips.js reads - so the sheet shows the join order, not some
// second opinion about it.
if (SHEET_ONLY) {
    let files;
    const man = path.join(SHEET_ONLY, 'manifest.json');
    if (fs.existsSync(man)) {
        try {
            files = JSON.parse(fs.readFileSync(man, 'utf8')).clips
                .filter(c => c.got !== false).map(c => c.file);
        } catch { /* fall through to a plain listing */ }
    }
    if (!files || !files.length) {
        files = fs.readdirSync(SHEET_ONLY)
            .filter(f => /\.(mp4|webm|mov)$/i.test(f))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    files = files.filter(f => fs.existsSync(path.join(SHEET_ONLY, f)));
    if (!files.length) { console.error(`No clips found in ${SHEET_ONLY}`); process.exit(1); }
    const sheet = buildSheet(SHEET_ONLY, files, RUN_DIR);
    if (!sheet) { console.error('Contact sheet could not be built.'); process.exit(1); }
    log(`Contact sheet: ${sheet}`);
    log(`Clips shown  : ${files.length}, numbered in this order:`);
    files.forEach((f, i) => log(`  ${String(i + 1).padStart(2, '0')}. ${f}`));
    process.exit(0);
}

// ── the hover pass ----------------------------------------------------------
// A tile's caption - "Mia watches Daniel walk away" - is the ONLY thing in the
// grid that says which scene a clip is, and Flow does not render it until the
// tile has been pointed at. A cold inventory returns just "play_circle" and the
// scene mapping is lost; a warmed one returns the caption. So every tile gets
// scrolled past and hovered before anything is read.
//
// The caption is taken as the LONGEST line of the tile's text (see inventoryFn,
// which runs in-page and cannot call out to here). The other lines are Material
// icon ligature names - play_circle, favorite, redo, more_vert - which are all
// short single words, so the caption is always the longest thing in there. Crude,
// but it holds for every tile seen so far and it fails safe: a wrong caption is
// visible in the log, a missing one is not.
async function hoverPass(page, log) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 1800));
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 1200));

    // Scroll each tile into view and read its centre AFTERWARDS. The first
    // version of this read every centre up front and then reused those numbers,
    // so most of them pointed off-screen (y = -1144) and only the few tiles
    // already in the viewport ever got hovered - which is why half the captions
    // came back as bare "play_circle".
    const TILE_SEL = 'flow-video-tile, flow-image-tile, [class*="video-tile"], [class*="media-tile"]';
    const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, TILE_SEL);
    let hovered = 0;
    for (let i = 0; i < count; i++) {
        const c = await page.evaluate(({ sel, i }) => {
            const t = [...document.querySelectorAll(sel)][i];
            if (!t) return null;
            t.scrollIntoView({ block: 'center' });
            const b = t.getBoundingClientRect();
            if (b.width <= 0 || b.height <= 0) return null;
            return { cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2) };
        }, { sel: TILE_SEL, i });
        await new Promise(r => setTimeout(r, 320));
        if (!c) continue;
        try { await page.mouse.move(c.cx, c.cy); hovered++; } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 380));
    }
    log(`Hovered ${hovered}/${count} tiles to force the captions to render.`);
}

async function fetchAsset(page, url, cookieHeader, userAgent) {
    // /asb assets use the signed-in Flow session, not flow-content cookies.
    // Fetch these inside Chrome so Google receives the correct credentials.
    if (!url.startsWith('blob:') && new URL(url).origin === 'https://flow.google.com') {
        return downloadFlowAsset(page, url);
    }
    if (url.startsWith('blob:')) {
        const result = await page.evaluate(fetchB64Fn, url);
        if (!result.ok) return result;
        const buf = Buffer.from(result.b64, 'base64');
        return hasVideoContainer(buf) ? { ok: true, buf }
            : { ok: false, why: 'Authenticated fetch did not return video bytes.' };
    }
    return fetchFromNode(url, cookieHeader, userAgent);
}

// Walk the real Flow scroll container and merge every virtualized tile. Flow
// keeps only the current viewport's custom elements mounted, so one DOM
// inventory can never represent a long project reliably.
async function scanVirtualGrid(page, log) {
    const metrics = await page.evaluate(() => {
        const s = document.querySelector('.cdk-virtual-scrollable.page-container, .page-container');
        return s ? { client: s.clientHeight, scroll: s.scrollHeight } : null;
    });
    if (!metrics || !metrics.client) {
        await hoverPass(page, log);
        return await page.evaluate(inventoryFn);
    }
    const records = new Map();
    const merge = (snap) => {
        for (const tile of snap.tiles) {
            const key = tile.assetId ? `${tile.tag}:${tile.assetId}`
                : `${Math.round(tile.gridY / 20)}:${Math.round(tile.gridX / 20)}:${tile.tag}`;
            const old = records.get(key);
            // Prefer the observation where Flow had mounted the real video.
            if (!old || tile.videoCount >= old.videoCount || !old.assetId) records.set(key, tile);
        }
    };

    // Flow appends another batch only after the last loaded tile approaches the
    // viewport. Its page-container has a large prompt/editor tail, so scrolling
    // to scrollHeight skips the loading sentinel. Move to the end of the actual
    // tile list and wait for its DOM count to grow instead.
    await page.evaluate(() => {
        const s = document.querySelector('.cdk-virtual-scrollable.page-container, .page-container');
        if (s) s.scrollTop = 0;
    });
    await wait(700);
    let rounds = 0;
    let stalled = 0;
    while (rounds++ < 20) {
        let snap = await page.evaluate(inventoryFn);
        merge(snap);
        const lastBottom = snap.tiles.reduce((m, t) => Math.max(m, t.gridY + t.rect.h), 0);
        const target = Math.max(0, lastBottom - Math.floor(metrics.client * 0.72));
        await page.evaluate(y => {
            const s = document.querySelector('.cdk-virtual-scrollable.page-container, .page-container');
            if (s) { s.scrollTop = y; s.dispatchEvent(new Event('scroll', { bubbles: true })); }
        }, target);
        const before = records.size;
        // First load of an older batch can take several seconds. Poll from
        // Node so Chrome background-tab timer throttling cannot shorten waits.
        for (let poll = 0; poll < 12; poll++) {
            await wait(750);
            snap = await page.evaluate(inventoryFn);
            merge(snap);
            if (records.size > before) break;
        }
        if (records.size > before) stalled = 0;
        else if (++stalled >= 2) break;
    }
    const tiles = [...records.values()].sort((a, b) =>
        Math.abs(a.gridY - b.gridY) > 20 ? a.gridY - b.gridY : a.gridX - b.gridX);
    tiles.forEach((tile, index) => { tile.index = index; });
    // Collect sources while traversing the grid, before network transfers. Flow
    // can unmount a batch while a slow download is running.
    for (const tile of tiles.filter(t => METHOD !== 'menu' && isVideoRecord(t) && !isFailedRecord(t))) {
        const video = (tile.videoSrcs || []).find(v => v.currentSrc || v.src);
        // Flow's observed /asb playback source uses the same asset token as its
        // preview with =mm,22,15 appended. Off-screen tiles need not be mounted
        // to request this candidate. It is always checked as actual video bytes
        // and decoded before it can count as a successful download.
        const preview = (tile.imgSrcs || []).find(u => /^https:\/\/flow\.google\.com\/asb\//.test(u));
        const candidate = video ? (video.currentSrc || video.src)
            : preview ? preview.split('=')[0] + '=mm,22,15' : null;
        if (candidate) {
            tile.downloadSrc = candidate;
            continue;
        }
        const mounted = await activateVideoTile(page, tile);
        if (mounted.ok) tile.downloadSrc = mounted.src;
        const snap = await page.evaluate(inventoryFn);
        const current = snap.tiles.find(t => tile.assetId && t.assetId === tile.assetId)
            || snap.tiles.find(t => Math.abs(t.gridY - tile.gridY) < 30 && Math.abs(t.gridX - tile.gridX) < 30);
        if (current) {
            tile.prompt = current.prompt || tile.prompt;
            tile.assetId = current.assetId || tile.assetId;
            tile.caption = current.caption || tile.caption;
            tile.hasMoreOptions = current.hasMoreOptions;
        }
    }
    await page.evaluate(() => {
        const s = document.querySelector('.cdk-virtual-scrollable.page-container, .page-container');
        if (s) s.scrollTop = 0;
    });
    await wait(500);
    log(`Scanned ${rounds} loaded grid batch(es); ${tiles.length} unique tile(s) discovered.`);
    return { url: page.url(), tileCount: tiles.length, tiles, visualOrder: tiles.map(t => t.index) };
}

// Bring one virtualized tile into view and wait for Flow to mount its <video>
// source. The old downloader inventoried once at the end, when only the last
// viewport's videos were mounted, so a 13-clip project looked like six videos
// plus seven images. This check happens immediately while each tile is active.
async function activateVideoTile(page, tile, needSource = true) {
    const TILE_SEL = 'flow-video-tile, flow-image-tile, [class*="video-tile"], [class*="media-tile"]';
    await page.evaluate(gridY => {
        const s = document.querySelector('.cdk-virtual-scrollable.page-container, .page-container');
        if (s) s.scrollTop = Math.max(0, gridY - s.clientHeight / 2);
    }, tile.gridY);
    let located = null;
    for (let mountTry = 0; mountTry < 12 && !located; mountTry++) {
    await wait(750);
    located = await page.evaluate(({ sel, wanted }) => {
        const tiles = [...document.querySelectorAll(sel)].filter(el => {
            const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
        });
        const s = document.querySelector('.cdk-virtual-scrollable.page-container, .page-container');
        const sr = s ? s.getBoundingClientRect() : { x: 0, y: 0 };
        const sy = s ? s.scrollTop : window.scrollY, sx = s ? s.scrollLeft : window.scrollX;
        const ranked = tiles.map((el, idx) => {
            const r = el.getBoundingClientRect();
            const gy = Math.round(sy + r.y - sr.y), gx = Math.round(sx + r.x - sr.x);
            const media = el.querySelector('video[src], img[src]');
            const id = ((media?.getAttribute('src') || '').match(/\/(?:video|image|asb)\/([^=?/#]+)/) || [])[1];
            const distance = wanted.assetId && id === wanted.assetId ? 0
                : wanted.assetId && id ? Infinity : Math.abs(gy - wanted.gridY) + Math.abs(gx - wanted.gridX);
            return { el, idx, r, distance };
        }).sort((a, b) => a.distance - b.distance);
        const hit = ranked[0];
        if (!hit || hit.distance > 100) return null;
        hit.el.scrollIntoView({ block: 'center' });
        const r = hit.el.getBoundingClientRect();
        return { idx: hit.idx, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, { sel: TILE_SEL, wanted: tile });
    }
    if (!located) return { ok: false, why: 'tile missing while activating', domIndex: null };
    await wait(500);
    try { await page.mouse.move(located.x, located.y); } catch { /* menu fallback remains */ }
    if (!needSource) return { ok: true, domIndex: located.idx };
    let info = { ok: false, why: 'video source did not mount' };
    for (let attempt = 0; attempt < 12; attempt++) {
        await wait(attempt ? 500 : 900);
        info = await page.evaluate(srcFn, located.idx);
        if (info.ok) return { ...info, domIndex: located.idx };
    }
    return { ...info, domIndex: located.idx };
}

(async () => {
    fs.mkdirSync(RUN_DIR, { recursive: true });

    const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
    const { normalizeProjectUrl, selectAgentPage } = require('./flow_project');
    const requestedUrl = flag('--project-url') ? normalizeProjectUrl(flag('--project-url')) : '';
    const { page, pages } = await selectAgentPage(browser, requestedUrl);
    if (!page) {
        console.error('No Flow tab found. Open the Flow project first.');
        console.error('Open tabs:\n  ' + pages.map(p => p.url()).join('\n  '));
        process.exit(1);
    }
    if (requestedUrl && page.url() !== requestedUrl) {
        await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await wait(5000);
    }
    log(`Flow tab: ${page.url()}`);
    await page.bringToFront();

    // Agent Mode clips live on the project home, not in the scene editor.
    const m = page.url().match(/\/project\/([a-zA-Z0-9_-]+)/i);
    if (!m) { console.error(`No project id in ${page.url()}`); await browser.disconnect(); process.exit(1); }
    const homeUrl = `https://flow.google.com/project/${m[1]}`;
    if (/\/edit\/|\/scene\//i.test(page.url())) {
        log('In the scene editor - going back to the project home.');
        await page.goto(homeUrl, { waitUntil: 'domcontentloaded' });
        await wait(6000);
    }
    await wait(2500);

    // ---- inventory ---------------------------------------------------------
    // Hover first: without it the captions are blank and the scene mapping is
    // unrecoverable from the grid alone.
    const inv = await scanVirtualGrid(page, log);
    fs.writeFileSync(path.join(RUN_DIR, 'tiles.json'), JSON.stringify(inv, null, 2));
    banner('PROJECT GRID');
    log(`Tiles found: ${inv.tileCount}   (dump: ${path.join(RUN_DIR, 'tiles.json')})`);
    if (!inv.tileCount) {
        log('No tiles detected. Either the project is empty or the tile markup differs.');
        log('Open the project in the browser and re-run --probe.');
        await browser.disconnect();
        return;
    }

    const byIndex = new Map(inv.tiles.map(t => [t.index, t]));
    inv.visualOrder.forEach((idx, n) => {
        const t = byIndex.get(idx);
        const src = (t.videoSrcs[0] || {});
        log(`  ${String(n + 1).padStart(2, '0')}. tile#${idx} ${t.rect.w}x${t.rect.h} @${t.rect.x},${t.rect.y} ` +
            `videos=${t.videoCount} moreOptions=${t.hasMoreOptions ? 'yes' : 'NO'}`);
        if (src.src) log(`      src: ${String(src.src).slice(0, 100)}`);
        if (t.caption) log(`      caption: ${t.caption}`);
        const label = (t.text || t.aria || t.title || '').replace(/\n/g, ' | ').slice(0, 110);
        if (label && !t.caption) log(`      says: ${label}`);
    });

    // A project grid mixes VIDEO tiles with IMAGE tiles - the character reference
    // sheets live in the same grid. They are not clips, and treating them as
    // clips produced two failures at once: the route check below could never
    // match (12 videos out of 14 tiles), so it silently dropped to the slow menu
    // route, and the two sheets would have been saved as scene-13/scene-14.
    // Everything downstream counts VIDEO tiles only.
    const failedVideoTiles = inv.tiles.filter(t => isVideoRecord(t) && isFailedRecord(t));
    const videoTiles = inv.tiles.filter(t => isVideoRecord(t) && !isFailedRecord(t));
    const imageTiles = inv.tiles.filter(t => !isVideoRecord(t));
    const withSrc  = videoTiles.filter(t => (t.videoSrcs[0] || {}).src).length;
    const withMenu = videoTiles.filter(t => t.hasMoreOptions).length;

    log('');
    log(`Ready video tiles: ${videoTiles.length}    failed video tiles (skipped): ${failedVideoTiles.length}    image tiles (skipped): ${imageTiles.length}`);
    if (failedVideoTiles.length) {
        log('  Failed generations are excluded. Use Agent Mode > Retry failed clips.');
    }
    if (imageTiles.length) {
        // Strip the Material icon ligature names to leave the asset's own name.
        const names = imageTiles.map(t => (t.text || '')
            .replace(/play_circle|favorite|more_vert|redo|image|add_2|download/g, ' ')
            .replace(/\s+/g, ' ').trim().slice(0, 30) || '(unnamed)');
        log(`  not clips, so not downloaded: ${names.join(', ')}`);
    }
    log(`Direct <video src> available on : ${withSrc}/${videoTiles.length} video tiles`);
    log(`"More options" menu available on: ${withMenu}/${videoTiles.length} video tiles`);

    if (!videoTiles.length) {
        log('');
        log('No video tiles in this project - nothing to download.');
        await browser.disconnect();
        return;
    }

    if (PROBE) {
        log('');
        log('--probe: nothing clicked, nothing downloaded.');
        log(`Full dump: ${path.join(RUN_DIR, 'tiles.json')}`);
        await browser.disconnect();
        return;
    }

    // ---- decide the method -------------------------------------------------
    const method = METHOD;
    if (!['auto', 'src', 'menu'].includes(method)) {
        console.error(`Unknown --method "${method}". Use auto, src or menu.`);
        await browser.disconnect(); process.exit(1);
    }
    if (method === 'menu' && !withMenu) {
        console.error('--method menu requested but no tile has a More options button.');
        await browser.disconnect();
        process.exit(1);
    }
    if (method === 'src' && withSrc < videoTiles.length) {
        log(`Only ${withSrc}/${videoTiles.length} sources are mounted now; each tile will be activated before download.`);
    }
    log(`Route: ${method === 'auto' ? 'per-tile direct source, then Download-menu fallback'
        : method === 'src' ? 'per-tile direct source (menu fallback if available)'
        : 'More options -> Download menu'}`);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    // Older versions saved login HTML as MP4 and cached it indefinitely. Keep
    // these bad files for diagnosis, outside the playable clip folder.
    for (const name of fs.readdirSync(OUT_DIR).filter(n => /\.mp4$/i.test(n))) {
        const file = path.join(OUT_DIR, name);
        if (hasVideoContainer(fs.readFileSync(file))) continue;
        const rejected = path.join(OUT_DIR, 'rejected-downloads', RUN_ID);
        fs.mkdirSync(rejected, { recursive: true });
        fs.renameSync(file, path.join(rejected, name));
        log(`Quarantined non-video file: ${name}`);
    }
    log(`Output folder: ${OUT_DIR}`);

    // Native browser downloads land wherever Chrome was told to put them. Pin it
    // so a stray file never ends up in the user's real Downloads folder.
    const dlDir = path.join(RUN_DIR, 'browser_downloads');
    fs.mkdirSync(dlDir, { recursive: true });
    let cdp = null;
    try {
        cdp = await page.createCDPSession();
        await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: true });
        log(`Browser downloads pinned to ${dlDir}`);
    } catch (e) {
        log(`Could not pin the download folder (${e.message.slice(0, 80)}) - files may land in the real Downloads.`);
    }

    // Credentials for the Node-side fallback fetch. Gathered once, up front, so
    // a failure to collect them is reported here rather than surfacing later as
    // an unexplained 403 on clip 7.
    let userAgent = '';
    let cookieHeader = '';
    try {
        userAgent = await page.evaluate(() => navigator.userAgent);
        if (cdp) {
            const c = await cdp.send('Network.getCookies', { urls: ['https://flow-content.google/'] });
            cookieHeader = (c.cookies || []).map(x => `${x.name}=${x.value}`).join('; ');
        }
    } catch (e) {
        log(`Could not collect fetch credentials (${e.message.slice(0, 60)}) - the Node fallback may fail.`);
    }

    // ---- download ----------------------------------------------------------
    // On-screen order among VIDEO tiles only - dropping the image tiles must not
    // leave gaps in the numbering, or scene-03 would be missing for no reason.
    // A repeated Agent request can put the exact same generated asset in the
    // grid more than once. Download each stable asset id once; otherwise one
    // clip can occupy two scene filenames and falsely satisfy the count gate.
    const seenAssets = new Set();
    const videoVisual = inv.visualOrder.filter(idx => {
        const tile = byIndex.get(idx);
        if (!isVideoRecord(tile) || isFailedRecord(tile)) return false;
        if (tile.assetId) {
            if (seenAssets.has(tile.assetId)) return false;
            seenAssets.add(tile.assetId);
        }
        return true;
    });
    const duplicateAssets = videoTiles.length - videoVisual.length;
    if (duplicateAssets > 0) log(`Duplicate generated assets skipped: ${duplicateAssets}`);
    const order = REVERSE ? [...videoVisual].reverse() : videoVisual;
    if (REVERSE) log('--reverse: numbering newest-first.');
    const targets = LIMIT ? order.slice(0, LIMIT) : order;
    // Older interrupted passes could overwrite scene filenames without updating
    // their manifest. Never use those unverified bytes to declare success.
    const cacheDir = path.join(OUT_DIR, '.download-cache', m[1]);
    fs.mkdirSync(cacheDir, { recursive: true });
    // Transfer a few independent signed assets concurrently. Browser navigation
    // has finished, and failures stay local to each clip.
    let nextTransfer = 0;
    const transfers = targets.map(idx => byIndex.get(idx)).filter(t => t.downloadSrc && !t.downloadSrc.startsWith('blob:'));
    await Promise.all(Array.from({length:Math.min(3, transfers.length)}, async () => {
        while (nextTransfer < transfers.length) {
            const t = transfers[nextTransfer++];
            const u = new URL(t.downloadSrc);
            const key = createHash('sha256').update(u.origin + u.pathname).digest('hex');
            const file = path.join(cacheDir, key + '.mp4');
            if (fs.existsSync(file) && hasVideoContainer(fs.readFileSync(file))) continue;
            for (let attempt=0; attempt<2; attempt++) {
                const result = await fetchAsset(page, t.downloadSrc, cookieHeader, userAgent);
                if (result.ok && result.buf.length > 10000) {
                    fs.writeFileSync(file + '.part', result.buf);
                    fs.renameSync(file + '.part', file);
                    log(`Cached clip ${t.index + 1}: ${(result.buf.length/1048576).toFixed(2)} MB`);
                    break;
                }
                log(`Retrying clip ${t.index + 1}: ${result.why || 'empty response'}`);
            }
        }
    }));
    const clips = [];
    let ok = 0, failed = 0;
    function checkpoint() {
        const temp = path.join(OUT_DIR, 'manifest.json.tmp');
        fs.writeFileSync(temp, JSON.stringify({
            projectUrl: homeUrl, downloadedAt: new Date().toISOString(),
            expected: EXPECTED || targets.length, complete: false,
            route: method, reversed: REVERSE, clips,
        }, null, 2));
        fs.renameSync(temp, path.join(OUT_DIR, 'manifest.json'));
    }
    checkpoint();

    for (let n = 0; n < targets.length; n++) {
        const tileIdx = targets[n];
        const t = byIndex.get(tileIdx);
        const name = `scene-${String(n + 1).padStart(2, '0')}.mp4`;
        const dest = path.join(OUT_DIR, name);
        log('');
        log(`[${n + 1}/${targets.length}] tile#${tileIdx} -> ${name}`);

        let wrote = false;

        if (method !== 'menu') {
            const info = t.downloadSrc ? {ok:true,src:t.downloadSrc,kind:t.downloadSrc.startsWith('blob:')?'blob':'url'}
                : await activateVideoTile(page, t);
            if (!info.ok) {
                log(`   no src: ${info.why}`);
            } else {
                log(`   src (${info.kind}): ${String(info.src).slice(0, 90)}`);
                // Signed CDN URLs work from Node. Browser fetch is reserved for
                // blob URLs; cross-origin browser fetch can fail or hang.
                let saved = null;
                const asset = info.kind === 'url' ? new URL(info.src) : null;
                const cacheKey = asset ? createHash('sha256').update(asset.origin + asset.pathname).digest('hex') : null;
                const cacheFile = cacheKey ? path.join(cacheDir, cacheKey + '.mp4') : null;
                if (cacheFile && fs.existsSync(cacheFile) && hasVideoContainer(fs.readFileSync(cacheFile))) {
                    saved = { buf: fs.readFileSync(cacheFile), how: 'verified asset cache' };
                }
                const inPage = !saved && info.kind === 'blob'
                    ? await page.evaluate(fetchB64Fn, info.src)
                    : { ok: false, why: 'signed URL: using Node' };
                if (saved) {
                    // Already downloaded this exact asset during an earlier pass.
                } else if (inPage.ok && hasVideoContainer(Buffer.from(inPage.b64, 'base64'))) {
                    saved = { buf: Buffer.from(inPage.b64, 'base64'), how: 'in-page fetch' };
                } else {
                    const why = inPage.ok ? `only ${inPage.bytes} bytes` : inPage.why;
                    log(`   in-page fetch gave nothing (${why}) - retrying from Node`);
                    let viaNode = { ok: false, why: 'blob source requires browser download' };
                    if (info.kind !== 'blob') {
                        for (let attempt = 0; attempt < 3; attempt++) {
                            viaNode = await fetchAsset(page, info.src, cookieHeader, userAgent);
                            if (viaNode.ok && viaNode.buf.length > 10000) break;
                            log(`   transfer attempt ${attempt + 1}/3 failed: ${viaNode.why || 'empty response'}`);
                            await wait(1000);
                        }
                    }
                    if (viaNode.ok && viaNode.buf.length > 10000) {
                        saved = { buf: viaNode.buf, how: 'node fetch' };
                    } else {
                        log(`   node fetch failed too: ${viaNode.why || `only ${viaNode.buf ? viaNode.buf.length : 0} bytes`}`);
                    }
                }
                if (saved) {
                    fs.writeFileSync(dest + '.part', saved.buf);
                    const validation = playableVideo(dest + '.part');
                    if (validation.ok) {
                        if (cacheFile) fs.writeFileSync(cacheFile, saved.buf);
                        fs.renameSync(dest + '.part', dest);
                        log(`   saved ${(saved.buf.length / 1048576).toFixed(2)} MB (${saved.how}; decoded ${validation.duration.toFixed(2)}s video)`);
                        wrote = true;
                    } else {
                        log(`   rejected: ${validation.why}; trying browser Download menu`);
                    }
                }
            }
        }

        // Auto uses the menu for a tile whose source never mounted. Explicit
        // src keeps the historical safety fallback when a menu is available.
        if (!wrote && method !== 'menu' && !t.hasMoreOptions) {
            log('   no Download menu is available for this tile.');
        }
        if (!wrote && (method === 'menu' || t.hasMoreOptions)) {
            const before = fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : [];
            const active = await activateVideoTile(page, t, false);
            const opened = active.domIndex === null
                ? { ok: false, why: 'tile could not be mounted for its menu' }
                : await page.evaluate(openMenuFn, active.domIndex);
            if (!opened.ok) {
                log(`   cannot open menu: ${opened.why}`);
            } else {
                await wait(SETTLE);
                const menu = await page.evaluate(menuFn);
                fs.writeFileSync(path.join(RUN_DIR, `menu_tile${tileIdx}.json`), JSON.stringify(menu, null, 2));
                if (!menu.open) {
                    log('   menu did not open.');
                } else {
                    log(`   menu items: ${menu.items.map(i => `"${i.text || i.aria}"`).join(', ').slice(0, 160)}`);
                    const hit = menu.items.find(i => /download/i.test(i.text || '') || /download/i.test(i.aria || ''));
                    if (!hit) {
                        log('   NO download entry in this menu. Dump saved for inspection.');
                    } else {
                        log(`   clicking "${hit.text || hit.aria}"`);
                        await page.mouse.click(hit.cx, hit.cy);
                        // Wait for a settled file to appear.
                        const deadline = Date.now() + 90000;
                        let fresh = null;
                        while (Date.now() < deadline) {
                            await wait(1500);
                            const now = fs.readdirSync(dlDir);
                            const added = now.filter(f => !before.includes(f) && !/\.crdownload$/i.test(f) && !/\.part$/i.test(f));
                            if (added.length) {
                                const full = path.join(dlDir, added[0]);
                                const s1 = fs.statSync(full).size;
                                await wait(2500);
                                if (fs.existsSync(full) && fs.statSync(full).size === s1 && s1 > 10000) { fresh = full; break; }
                            }
                        }
                        if (fresh) {
                            const validation = playableVideo(fresh);
                            if (validation.ok) {
                                fs.copyFileSync(fresh, dest);
                                log(`   saved ${(fs.statSync(dest).size / 1048576).toFixed(2)} MB (browser download; decoded ${validation.duration.toFixed(2)}s video)`);
                                wrote = true;
                            } else log(`   rejected browser download: ${validation.why}`);
                        } else {
                            log('   no file appeared within 90s.');
                        }
                    }
                }
            }
            // Whatever happened, never leave a menu open over the next tile.
            await page.keyboard.press('Escape');
            await wait(700);
        }

        if (wrote) ok++; else failed++;
        clips.push({
            file: name,
            tileIndex: tileIdx,
            order: n + 1,
            rect: t.rect,
            // The caption is the closest thing this grid has to a scene label -
            // it is what makes the numbering checkable after the fact.
            caption: t.caption || '',
            prompt: t.prompt || '',
            assetId: t.assetId || null,
            got: wrote,
        });
        checkpoint();
    }

    // ---- manifest ----------------------------------------------------------
    // join_clips.js reads this. It records the order files were written in, so
    // the join follows what this script actually did rather than re-deriving an
    // order from filenames and hoping.
    const selection = STORY_FILE ? selectStoryClips(clips, JSON.parse(fs.readFileSync(STORY_FILE, 'utf8'))) : null;
    const resolved = selection && !selection.missing.length;
    const storyReady = resolved || (!selection && (!EXPECTED || ok === EXPECTED));
    const downloadState = require('./download_tile_logic').downloadCompletion(clips, EXPECTED, storyReady, failed);
    const manifest = {
        projectUrl: homeUrl,
        downloadedAt: new Date().toISOString(),
        route: method,
        expected: EXPECTED || null,
        complete: failed === 0 && storyReady,
        downloadComplete: downloadState.downloadComplete,
        needsSceneOrdering: downloadState.needsSceneOrdering,
        ...(resolved ? {orderResolvedBy:'project_prompt', alternateClips:selection.extras} : {}),
        reversed: REVERSE,
        gridOrderNote: `Files are numbered in ${REVERSE ? 'REVERSE on-screen' : 'on-screen'} order `
            + '(top-to-bottom, left-to-right). But a tile is NOT a scene: Flow renders an '
            + 'Agent-Mode batch as its queue drains, so the grid is in COMPLETION order and these '
            + 'numbers say nothing about which scene a clip is - measured on one real run, grid '
            + 'position 1 held story scene 11 and the grid read 11,13,10,14,12,5,7,6,3,9,2,8,4,1. '
            + 'Run order_clips_by_dialogue.js (npm run agent:order, or the order_clips MCP tool) to '
            + 'establish the real order from what each clip says, which rewrites this manifest into '
            + 'story order for join_clips.js to follow. Only --order or --reverse by hand otherwise.',
        clips: resolved ? selection.selected : clips,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

    banner('DOWNLOAD SUMMARY');
    log(`Route     : ${method}`);
    log(`Saved     : ${ok} clip(s) to ${OUT_DIR}`);
    if (failed) log(`Failed    : ${failed} clip(s) - see the log above for why`);
    if (resolved) log(`Story      : ${selection.selected.length} scenes in story order; ${selection.extras.length} alternate clips retained separately in the manifest.`);
    if (!downloadState.downloadComplete) log(`DOWNLOAD INCOMPLETE: story expects ${EXPECTED} clips; ${ok} playable files saved. Recover missing downloads/generations before joining.`);
    else if (downloadState.needsSceneOrdering) log(`DOWNLOAD COMPLETE: ${ok} playable clips saved. Scene order is pending; the pipeline will match their spoken dialogue before joining.`);
    log(`Manifest  : ${path.join(OUT_DIR, 'manifest.json')}`);
    log('');
    log('Order (as numbered):');
    for (const c of clips) log(`  ${String(c.order).padStart(2, '0')}. ${c.file}  ${c.got ? '' : '(FAILED) '}${c.caption.slice(0, 70)}`);

    // The grid carries no scene labels, so this image is the only cheap way to
    // confirm the numbering before joining. Build it whenever clips landed.
    if (SHEET && ok) {
        log('');
        const got = clips.filter(c => c.got).map(c => c.file);
        const sheet = buildSheet(OUT_DIR, got, RUN_DIR);
        if (sheet) {
            log(`Contact sheet: ${sheet}`);
            log('  Open it - each tile is stamped with its clip number. Confirm that');
            log('  clip 01 really is scene 1 before joining.');
        } else {
            log('Contact sheet could not be built (ffmpeg missing, or no frames read).');
        }
    }

    log('');
    log('Check that order against your story scenes, then join:');
    log(`  node join_clips.js "${OUT_DIR}" --dry-run`);
    log(`  node join_clips.js "${OUT_DIR}"`);

    if (cdp) { try { await cdp.detach(); } catch {} }
    await browser.disconnect();
    if (!downloadState.downloadComplete) process.exitCode = 2;
})().catch(e => { console.error('DOWNLOAD FAILED:', e.message); process.exit(1); });
