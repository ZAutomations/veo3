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
        return {
            index: i,
            tag: t.tagName.toLowerCase(),
            cls: cls(t).slice(0, 140),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            // Every plausible identity signal, so the order question can be
            // settled from the dump instead of guessed at now.
            aria: t.getAttribute('aria-label'),
            title: t.getAttribute('title'),
            dataAttrs: [...t.attributes].filter(a => /^data-/.test(a.name)).map(a => `${a.name}=${a.value}`).slice(0, 12),
            text: (t.innerText || t.textContent || '').trim().slice(0, 200),
            caption,
            videoCount: vids.length,
            videoSrcs: vids.map(v => ({ src: v.getAttribute('src'), currentSrc: v.currentSrc || null, poster: v.getAttribute('poster'), dur: Number.isFinite(v.duration) ? v.duration : null })).slice(0, 3),
            imgSrcs: imgs.map(im => (im.getAttribute('src') || '').slice(0, 120)).slice(0, 3),
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
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
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
    const r = await fetch(url, { headers, redirect: 'follow' });
    if (!r.ok) return { ok: false, why: `HTTP ${r.status} ${r.statusText || ''}`.trim() };
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, buf };
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

(async () => {
    fs.mkdirSync(RUN_DIR, { recursive: true });

    const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
    const pages = await browser.pages();
    // Same as agent_mode.js: prefer the project tab over a Flow home tab
    // when the browser is carrying both.
    const flowTabs = pages.filter(p => /flow\.google\.com/i.test(p.url() || ''));
    const page = flowTabs.find(p => /\/project\//i.test(p.url() || '')) || flowTabs[0];
    if (!page) {
        console.error('No Flow tab found. Open the Flow project first.');
        console.error('Open tabs:\n  ' + pages.map(p => p.url()).join('\n  '));
        process.exit(1);
    }
    log(`Flow tab: ${page.url()}`);

    // Agent Mode clips live on the project home, not in the scene editor.
    const m = page.url().match(/\/project\/([0-9a-f-]+)/i);
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
    await hoverPass(page, log);
    const inv = await page.evaluate(inventoryFn);
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
    const videoTiles = inv.tiles.filter(t => t.videoCount > 0);
    const imageTiles = inv.tiles.filter(t => t.videoCount === 0);
    const withSrc  = videoTiles.filter(t => (t.videoSrcs[0] || {}).src).length;
    const withMenu = videoTiles.filter(t => t.hasMoreOptions).length;

    log('');
    log(`Video tiles: ${videoTiles.length}    image tiles (skipped): ${imageTiles.length}`);
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
    let method = METHOD;
    if (method === 'auto') {
        // Prefer the direct route: no menus, no dialog, and it cannot get the
        // per-tile mapping wrong because the bytes come from the tile itself.
        method = withSrc === videoTiles.length ? 'src' : (withMenu ? 'menu' : null);
    }
    if (method === 'src' && withSrc < videoTiles.length) {
        log(`--method src requested but only ${withSrc}/${videoTiles.length} video tiles expose a src.`);
        if (!withMenu) { console.error('No workable route. Stopping.'); await browser.disconnect(); process.exit(1); }
        log('Falling back to the menu route.');
        method = 'menu';
    }
    if (method === 'menu' && !withMenu) {
        console.error('--method menu requested but no tile has a More options button.');
        await browser.disconnect();
        process.exit(1);
    }
    if (!method) { console.error('No download route available on this page.'); await browser.disconnect(); process.exit(1); }
    log(`Route: ${method === 'src' ? 'direct <video src> fetch' : 'More options -> Download menu'}`);

    fs.mkdirSync(OUT_DIR, { recursive: true });
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
    const videoVisual = inv.visualOrder.filter(idx => (byIndex.get(idx) || {}).videoCount > 0);
    const order = REVERSE ? [...videoVisual].reverse() : videoVisual;
    if (REVERSE) log('--reverse: numbering newest-first.');
    const targets = LIMIT ? order.slice(0, LIMIT) : order;
    const clips = [];
    let ok = 0, failed = 0;

    for (let n = 0; n < targets.length; n++) {
        const tileIdx = targets[n];
        const t = byIndex.get(tileIdx);
        const name = `scene-${String(n + 1).padStart(2, '0')}.mp4`;
        const dest = path.join(OUT_DIR, name);
        log('');
        log(`[${n + 1}/${targets.length}] tile#${tileIdx} -> ${name}`);

        let wrote = false;

        if (method === 'src') {
            const info = await page.evaluate(srcFn, tileIdx);
            if (!info.ok) {
                log(`   no src: ${info.why}`);
            } else {
                log(`   src (${info.kind}): ${String(info.src).slice(0, 90)}`);
                // In-page first (handles blob:), then Node (handles the CDN's
                // missing CORS headers). See fetchFromNode for why both exist.
                let saved = null;
                const inPage = await page.evaluate(fetchB64Fn, info.src);
                if (inPage.ok && inPage.bytes > 10000) {
                    saved = { buf: Buffer.from(inPage.b64, 'base64'), how: 'in-page fetch' };
                } else {
                    const why = inPage.ok ? `only ${inPage.bytes} bytes` : inPage.why;
                    log(`   in-page fetch gave nothing (${why}) - retrying from Node`);
                    const viaNode = await fetchFromNode(info.src, cookieHeader, userAgent);
                    if (viaNode.ok && viaNode.buf.length > 10000) {
                        saved = { buf: viaNode.buf, how: 'node fetch' };
                    } else {
                        log(`   node fetch failed too: ${viaNode.why || `only ${viaNode.buf ? viaNode.buf.length : 0} bytes`}`);
                    }
                }
                if (saved) {
                    fs.writeFileSync(dest, saved.buf);
                    log(`   saved ${(saved.buf.length / 1048576).toFixed(2)} MB  (${saved.how})`);
                    wrote = true;
                }
            }
        }

        if (!wrote && method === 'menu') {
            const before = fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : [];
            const opened = await page.evaluate(openMenuFn, tileIdx);
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
                            fs.copyFileSync(fresh, dest);
                            log(`   saved ${(fs.statSync(dest).size / 1048576).toFixed(2)} MB`);
                            wrote = true;
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
            got: wrote,
        });
    }

    // ---- manifest ----------------------------------------------------------
    // join_clips.js reads this. It records the order files were written in, so
    // the join follows what this script actually did rather than re-deriving an
    // order from filenames and hoping.
    const manifest = {
        projectUrl: homeUrl,
        downloadedAt: new Date().toISOString(),
        route: method,
        reversed: REVERSE,
        gridOrderNote: `Files are numbered in ${REVERSE ? 'REVERSE on-screen' : 'on-screen'} order `
            + '(top-to-bottom, left-to-right). But a tile is NOT a scene: Flow renders an '
            + 'Agent-Mode batch as its queue drains, so the grid is in COMPLETION order and these '
            + 'numbers say nothing about which scene a clip is - measured on one real run, grid '
            + 'position 1 held story scene 11 and the grid read 11,13,10,14,12,5,7,6,3,9,2,8,4,1. '
            + 'Run order_clips_by_dialogue.js (npm run agent:order, or the order_clips MCP tool) to '
            + 'establish the real order from what each clip says, which rewrites this manifest into '
            + 'story order for join_clips.js to follow. Only --order or --reverse by hand otherwise.',
        clips,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

    banner('DOWNLOAD SUMMARY');
    log(`Route     : ${method}`);
    log(`Saved     : ${ok} clip(s) to ${OUT_DIR}`);
    if (failed) log(`Failed    : ${failed} clip(s) - see the log above for why`);
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
})().catch(e => { console.error('DOWNLOAD FAILED:', e.message); process.exit(1); });
