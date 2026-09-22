#!/usr/bin/env node
/**
 * GENERATE REFERENCE IMAGES IN FLOW  (Agent Mode pre-step)
 * =======================================================
 * Builds the reference images INSIDE the Flow project, so nothing is generated
 * by hand, saved to a folder, or renamed by hand. Then the normal Agent Mode run
 * just @-mentions the tiles this made (agent_mode.js --no-upload-refs), instead
 * of uploading local files.
 *
 * For each entry in the story's refs.json:
 *   1. Agent Mode OFF (a plain prompt makes an image; Agent Mode makes clips)
 *   2. paste the sheet/plate prompt into the Flow prompt box
 *   3. click Start generation
 *   4. wait for a new tile
 *   5. open that tile's More options -> Rename -> type the simple name ("Maya",
 *      "Leo", "Apartment") -> Done
 * Then Agent Mode ON again.
 *
 * Selectors are pinned from a live probe (probe_refs.js), not guessed:
 *   agent chip  flow-agent-mode-toggle-chip, class "checked" when ON
 *   prompt box  .ProseMirror
 *   submit      button[aria-label="Start generation"]   (enabled once text is in)
 *   tiles       [class*=hover-overlay] holding button[aria-label="More options"],
 *               newest FIRST; the header's own More-options is excluded
 *   menu        button.mat-mdc-menu-item with span.item-text "Rename"
 *   rename      .rename-tile-overlay input.editable-text-input  +  button[aria-label="Done"]
 *
 * Requires: the automation browser (CDP) on a Flow PROJECT page. The chip is
 * handled here: this script checks the Agent Mode chip and turns it OFF first,
 * because while it is ON the image models are not offered at all and a sheet
 * prompt makes a clip instead. The chip is put back ON at the end for the film
 * run, unless --keep-agent-on.
 *
 * Usage:
 *   node generate_refs.js --story stories/<slug>
 *   node generate_refs.js --story stories/<slug> --only Maya
 *   node generate_refs.js --refs stories/<slug>/refs.json --cdp 9222
 *   node generate_refs.js --story stories/<slug> --keep-agent-on
 *
 * Flags:
 *   --story DIR|FILE  the story folder (reads refs.json) or the refs file itself
 *   --refs FILE       explicit refs.json
 *   --only NAME       generate just this one ref (retry a single failure)
 *   --cdp N           CDP port (default 9222)
 *   --wait N          seconds to wait for each image (default 180)
 *   --keep-agent-on   leave Agent Mode as it was instead of turning it back on
 *   --dry             list what it would do; touch nothing
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function ts() { return new Date().toTimeString().slice(0, 8); }
function log(m) { console.log(`[${ts()}] ${m}`); }

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
const CDP_PORT = String(flag('--cdp', '9222'));
const STORY = typeof flag('--story') === 'string' ? flag('--story') : '';
const REFS_FILE = typeof flag('--refs') === 'string' ? flag('--refs') : '';
const ONLY = typeof flag('--only') === 'string' ? flag('--only') : '';
const RATIO = typeof flag('--ratio') === 'string' ? flag('--ratio').trim() : '';
const WAIT_S = num('--wait', 180);
const KEEP_AGENT = !!flag('--keep-agent-on', false);
const DRY = !!flag('--dry', false);

// ── refs.json ----------------------------------------------------------------
function refsPath() {
    if (REFS_FILE) return path.resolve(REFS_FILE);
    if (!STORY) return null;
    const p = path.resolve(STORY);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    return path.join(p, 'refs.json');
}
// Older stories have no refs.json - parse character_sheets.txt instead. Its
// shape is regular: "=== NAME ===", "save as: character_refs/<file>", and the
// line after "-- image prompt --" is the prompt.
function parseSheetsTxt(dir) {
    const f = path.join(dir, 'character_sheets.txt');
    if (!fs.existsSync(f)) return null;
    const txt = fs.readFileSync(f, 'utf8');
    const refs = [];
    for (const part of txt.split(/^===\s*/m).slice(1)) {
        const close = part.indexOf('===');
        if (close < 0) continue;
        const head = part.slice(0, close).trim();
        const body = part.slice(close + 3);
        const save = body.match(/save as:\s*character_refs\/([^\r\n]+)/i);
        const prompt = body.match(/-- image prompt --\s*[\r\n]+([^\r\n]+)/i);
        if (!save || !prompt) continue;
        const file = save[1].trim();
        refs.push({
            name: file.replace(/\.[a-z0-9]+$/i, ''),
            file,
            kind: /^place\b/i.test(head) ? 'place' : 'character',
            prompt: prompt[1].trim(),
        });
    }
    return refs.length ? refs : null;
}

function loadRefs() {
    const f = refsPath();
    if (!f) { console.error('Give --story <folder> or --refs <refs.json>.'); process.exit(1); }
    let refs = [];
    if (fs.existsSync(f)) {
        const db = JSON.parse(fs.readFileSync(f, 'utf8'));
        refs = Array.isArray(db) ? db : (db.refs || []);
    } else {
        const dir = path.dirname(f);
        const fromTxt = parseSheetsTxt(dir);
        if (!fromTxt) {
            console.error(`No refs.json at ${f}, and no character_sheets.txt to fall back on.`);
            console.error('Write the story first (`node write_story.js ...`).');
            process.exit(1);
        }
        log(`No refs.json - read ${path.basename(path.dirname(f))}/character_sheets.txt instead.`);
        refs = fromTxt;
    }
    refs = refs.filter((r) => r && r.prompt && String(r.prompt).trim());
    if (ONLY) {
        const want = ONLY.toLowerCase();
        refs = refs.filter((r) => String(r.name || '').toLowerCase() === want);
        if (!refs.length) { console.error(`--only ${ONLY} matches no ref in ${f}.`); process.exit(1); }
    }
    return refs;
}

// ── page helpers -------------------------------------------------------------
const MEDIA_MORE = `[...document.querySelectorAll('button[aria-label="More options"]')]
    .filter(b => !b.closest('.header-right-container, .header-desktop-main-row')
              && !!b.closest('[class*=hover-overlay]'))`;

async function countTiles(page) {
    return await page.evaluate((expr) => eval(expr).length, MEDIA_MORE);
}

// ---- the Agent Mode chip --------------------------------------------------
// This one chip decides whether a plain prompt makes an IMAGE or a CLIP. With it
// ON the image models are not even offered in the picker, so a sheet prompt
// submitted in that state comes back as a video - the "reference images came out
// as clips" failure. It is the whole switch, so this step reads it and turns it
// off before generating anything.
//
// Live DOM (Angular): the host carries class "checked" while ON, and the inner
// button carries "agent-mode-chip-checked" plus aria-pressed="true". Read the
// class AND the attribute, so a change to either binding still reads correctly.
// Returns null when the chip is not on the page at all (not a project page).
async function agentOn(page) {
    return await page.evaluate(() => {
        const host = document.querySelector('flow-agent-mode-toggle-chip');
        if (!host) return null;
        if (/checked/.test(String(host.className))) return true;
        const b = host.querySelector('button.agent-mode-chip') || host.querySelector('button');
        if (!b) return null;
        if (b.getAttribute('aria-pressed') === 'true') return true;
        return /agent-mode-chip-checked/.test(String(b.className));
    });
}

async function setAgent(page, want) {
    const now = await agentOn(page);
    if (now === null) return { ok: false, changed: false, why: 'the Agent chip is not on the page' };
    if (now === want) return { ok: true, changed: false, why: 'already there' };
    const clicked = await page.evaluate(() => {
        const host = document.querySelector('flow-agent-mode-toggle-chip');
        const b = host && (host.querySelector('button.agent-mode-chip') || host.querySelector('button'));
        if (!b) return false;
        b.click();
        return true;
    });
    if (!clicked) return { ok: false, changed: false, why: 'the chip button could not be clicked' };
    // Angular sets the class after the click, so poll for the new state rather
    // than sleeping a fixed time and assuming it took.
    for (let i = 0; i < 12; i++) {
        await wait(500);
        if (await agentOn(page) === want) return { ok: true, changed: true, why: 'clicked' };
    }
    return { ok: false, changed: true, why: `clicked, but it did not turn ${want ? 'ON' : 'OFF'}` };
}
// The always-visible tune button ("Settings") opens the full Settings panel,
// which holds the Image and Video generation defaults. The compact
// "Settings trigger" summary the first attempt used is display:none on a fresh
// project - that is why opening it failed - and a plain click() works fine on
// the tune button. We read the image default to confirm the sheets will be
// images (Nano Banana) and not clips.
async function openSettingsPanel(page) {
    for (let i = 0; i < 3; i++) {
        const clicked = await page.evaluate(() => {
            const b = document.querySelector('button[aria-label="Settings"]')
                || [...document.querySelectorAll('button')].find((x) => /^settings$/i.test((x.getAttribute('aria-label') || '').trim()));
            if (!b) return false;
            b.click();
            return true;
        });
        if (!clicked) { await wait(1500); continue; }
        await wait(2200);
        if (await page.evaluate(() => !!document.querySelector('.settings-content, .settings-section'))) return true;
        await page.keyboard.press('Escape');
        await wait(700);
    }
    return false;
}
// Read just the model row under "Image generation default".
async function readImageModel(page) {
    return await page.evaluate(() => {
        const sec = [...document.querySelectorAll('.settings-section')]
            .find((s) => /image generation default/i.test(s.innerText || ''));
        if (!sec) return null;
        return [...sec.querySelectorAll('button')]
            .map((b) => (b.innerText || '').replace(/crop_[a-z0-9_]+/gi, '').replace(/\s+/g, ' ').trim())
            .find((t) => /nano|imagen|banana|veo|omni|flash/i.test(t)) || null;
    });
}
const looksImageModel = (m) => /nano|imagen|banana/i.test(String(m));
// Set the aspect ratio in the two "generation default" sections of the open
// Settings panel, then Save. This is what actually makes the project generate
// in the batch's ratio - the prompt alone cannot change Flow's own setting.
async function setPanelRatio(page, ratio) {
    return await page.evaluate((r) => {
        const want = String(r).replace(/\s/g, '');
        let clicks = 0;
        for (const sec of document.querySelectorAll('.settings-section')) {
            if (!/image generation default|video generation default/i.test(sec.innerText || '')) continue;
            const target = [...sec.querySelectorAll('[role="radio"], button')]
                .find((el) => (el.innerText || '').replace(/\s+/g, '').includes(want));
            if (target && target.getAttribute('aria-checked') !== 'true') { target.click(); clicks++; }
        }
        return clicks;
    }, ratio);
}
async function clickSave(page) {
    return await page.evaluate(() => {
        const b = document.querySelector('.settings-save-button')
            || [...document.querySelectorAll('button')].find((x) => /^save$/i.test((x.innerText || '').trim()));
        if (!b) return false;
        b.click();
        return true;
    });
}
// "Confirm before generating: Always | Never". A fresh project (or a new account)
// comes up on "Always", which makes the agent STOP for a manual approval on
// every project. Set it to "Never" so generation is unattended.
async function setConfirmNever(page) {
    return await page.evaluate(() => {
        const sec = [...document.querySelectorAll('.settings-section')]
            .find((s) => /confirm before generating/i.test(s.innerText || ''));
        if (!sec) return 'no-section';
        const never = [...sec.querySelectorAll('[role="radio"], button')]
            .find((el) => /^never$/i.test((el.innerText || '').trim()));
        if (!never) return 'no-never';
        if (never.getAttribute('aria-checked') === 'true') return 'already';
        never.click();
        return 'clicked';
    });
}
// The panel leaves a backdrop that keeps Start generation disabled until it is
// really gone, so wait it out rather than assuming one Escape is enough.
async function closeSettings(page) {
    for (let i = 0; i < 4; i++) {
        if (!await page.evaluate(() => !!document.querySelector('.settings-content, .settings-section'))) return true;
        await page.keyboard.press('Escape');
        await wait(800);
    }
    await page.mouse.click(5, 5);
    await wait(700);
    return !(await page.evaluate(() => !!document.querySelector('.settings-content, .settings-section')));
}
// A freshly created project takes a moment to paint its prompt bar. Without
// this the very first settings click lands on nothing - which stopped a whole
// batch right after new_project.
async function waitForProjectReady(page, seconds = 45) {
    const t0 = Date.now();
    while ((Date.now() - t0) / 1000 < seconds) {
        const ready = await page.evaluate(() => !!(
            document.querySelector('button[aria-label="Settings"]')
            || document.querySelector('button[aria-label="Settings trigger"]')
            || document.querySelector('flow-base-prompt-box .ProseMirror, .ProseMirror')
        ));
        if (ready) return true;
        await wait(2000);
    }
    return false;
}
async function insertPrompt(page, text) {
    const ok = await page.evaluate(() => {
        const b = document.querySelector('flow-base-prompt-box .ProseMirror, .ProseMirror, [contenteditable="true"]');
        if (!b) return false;
        b.focus();
        return true;
    });
    if (!ok) { log('  no prompt box found'); return false; }
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    try {
        const client = (typeof page.createCDPSession === 'function')
            ? await page.createCDPSession() : await page.target().createCDPSession();
        await client.send('Input.insertText', { text });
        await client.detach().catch(() => {});
    } catch (e) {
        await page.keyboard.type(text, { delay: 2 });
    }
    await wait(700);
    // Verify it actually landed: after the Settings panel closes, focus can be
    // elsewhere, the insert goes nowhere, and Start generation stays disabled.
    const landed = await page.evaluate(() => {
        const b = document.querySelector('flow-base-prompt-box .ProseMirror, .ProseMirror, [contenteditable="true"]');
        return b ? (b.innerText || b.textContent || '').trim().length : 0;
    });
    if (!landed) { log('  prompt did not land in the box'); return false; }
    return true;
}
async function clickSubmit(page) {
    return await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')]
            .find((x) => /start generation/i.test(x.getAttribute('aria-label') || ''));
        if (!b) return { ok: false, why: 'no Start generation button' };
        if (b.disabled || String(b.className).includes('disabled')) return { ok: false, why: 'Start generation is disabled' };
        b.click();
        return { ok: true };
    });
}
async function waitForNewTile(page, before, seconds) {
    const t0 = Date.now();
    while ((Date.now() - t0) / 1000 < seconds) {
        const n = await countTiles(page);
        if (n > before) return n;
        await wait(3000);
    }
    return await countTiles(page);
}
// Read the on-screen name of tile `idx` (0 = newest). Hovering a tile swaps its
// label for action icons (favorite / redo / more_vert ...), so strip the icon
// ligature words and walk up until only real text is left.
async function tileName(page, idx) {
    return await page.evaluate(({ expr, i }) => {
        const ICON = /\b(play_circle|favorite|redo|undo|more_vert|edit|download|delete|delete_forever|keyboard_return|expand|add_2|add|tune|arrow_forward|article_spark|thumb_up|thumb_down|content_copy|flag|volume_up|share|video_library|photo_library|motion_blur|image|videocam|crop_free|crop_16_9|crop_9_16|crop_landscape|crop_square|crop_portrait|close|home|search|filter_list|help|refresh|check|done)\b/gi;
        const more = eval(expr);
        const b = more[i];
        if (!b) return null;
        let el = b.closest('[class*=hover-overlay], flow-image-tile, flow-video-tile');
        for (let k = 0; k < 6 && el; k++) {
            const t = (el.innerText || '').replace(ICON, ' ').replace(/\s+/g, ' ').trim();
            if (t) return t;
            el = el.parentElement;
        }
        return null;
    }, { expr: MEDIA_MORE, i: idx });
}

// The rename box is its OWN overlay (.rename-tile-overlay). An earlier version
// queried the whole document for ".editable-text-input, input[aria-label=
// Editable text]" and matched the FIRST such input - which is another tile's
// inline name field. The typed text went there, Done committed the rename
// box's still-unchanged value, and the function returned ok:true regardless.
// So: scope every lookup to the overlay, and VERIFY the tile name took.
async function renameNewest(page, name) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        await page.keyboard.press('Escape');
        await wait(700);
        const opened = await page.evaluate((expr) => {
            const more = eval(expr)[0];
            if (!more) return { ok: false, why: 'no media tile' };
            more.scrollIntoView({ block: 'center' });
            more.click();
            return { ok: true };
        }, MEDIA_MORE);
        if (!opened.ok) return opened;
        await wait(1800);
        const clicked = await page.evaluate(() => {
            const el = [...document.querySelectorAll('button.mat-mdc-menu-item, .item-text, [role="menuitem"]')]
                .find((x) => /^rename$/i.test((x.innerText || '').trim()));
            if (!el) return false;
            el.click();
            return true;
        });
        if (!clicked) { await page.keyboard.press('Escape'); return { ok: false, why: 'no Rename menu item' }; }
        await wait(2000);
        const focused = await page.evaluate(() => {
            const inp = document.querySelector('.rename-tile-overlay input.editable-text-input')
                || document.querySelector('.rename-tile-overlay input')
                || document.querySelector('.rename-tile-overlay [contenteditable="true"]')
                || document.querySelector('input.editable-text-input.editing');
            if (!inp) return false;
            inp.focus();
            return true;
        });
        if (!focused) { await page.keyboard.press('Escape'); return { ok: false, why: 'no rename input' }; }
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(name, { delay: 25 });
        await wait(700);
        const clickedDone = await page.evaluate(() => {
            const b = document.querySelector('.rename-tile-overlay button[aria-label="Done"]')
                || [...document.querySelectorAll('button')]
                    .find((x) => /^done$/i.test(x.getAttribute('aria-label') || ''));
            if (!b) return false;
            b.click();
            return true;
        });
        if (!clickedDone) await page.keyboard.press('Enter');
        await wait(1700);
        const now = await tileName(page, 0);
        if (now && now.toLowerCase().includes(name.toLowerCase())) return { ok: true, name: now };
        log(`  rename attempt ${attempt} did not take (tile still "${now}") - retrying`);
    }
    return { ok: false, why: 'rename did not commit after 3 attempts' };
}

// ── main ---------------------------------------------------------------------
if (require.main === module) (async () => {
    const refs = loadRefs();
    log(`${refs.length} reference image(s) to make:`);
    refs.forEach((r) => log(`  - ${r.name}  (${r.kind || 'ref'})`));
    if (DRY) { log('--dry: nothing generated.'); return; }

    let browser;
    try {
        browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}`, defaultViewport: null });
    } catch (e) {
        console.error(`Could not connect to Chrome on CDP port ${CDP_PORT}. Start the automation browser first.`);
        process.exit(1);
    }
    const page = (await browser.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow PROJECT tab open (need /project/<id>).'); await browser.disconnect(); process.exit(1); }
    log(`Project: ${page.url()}`);
    if (!await waitForProjectReady(page)) log('warning: prompt bar is slow to appear - still trying.');

    // ---- FIRST JOB: Agent Mode must be OFF --------------------------------
    // Do this before touching the model picker or the prompt box. With the agent
    // ON, the image models are not offered at all, so anything submitted makes a
    // clip - and a run that starts in that state produces a grid of videos where
    // the reference sheets should be. Check it, and turn it off, first.
    const wasAgentOn = await agentOn(page);
    if (wasAgentOn === null) {
        log('WARNING: the Agent Mode chip is not on the page - is the prompt bar loaded?');
    } else {
        log(`Agent Mode: ${wasAgentOn ? 'ON' : 'OFF'}`);
    }
    if (wasAgentOn) {
        log('Agent Mode is ON, which hides the image models. Turning it OFF to make sheets...');
        const off = await setAgent(page, false);
        log(off.ok
            ? 'Agent Mode is OFF - a plain prompt will now make an image.'
            : `WARNING: could not turn Agent Mode OFF (${off.why}) - the sheets may come out as CLIPS.`);
    }

    // The chip is already OFF, so an image model should be on offer here. If one
    // still is not, this is the Settings panel's own "Image generation default",
    // not the chip - so say so rather than leaving a grid of clips to explain it.
    log('checking the image generation model...');
    let imgMode = { ok: false, model: null };
    if (await openSettingsPanel(page)) {
        const model = await readImageModel(page);
        imgMode = { ok: looksImageModel(model), model };
        if (model) log(`image generation default: ${model}`);
        if (!looksImageModel(model)) {
            log('WARNING: the image default is not an image model, so the sheets may');
            log('come out as clips. Set Settings > Image generation default to Nano Banana.');
        }
        // Apply the batch's ratio to the project itself (image AND video
        // defaults), so every clip comes out in that shape.
        let changed = false;
        if (RATIO && !/^(flow|auto|default|none)$/i.test(RATIO)) {
            const n = await setPanelRatio(page, RATIO);
            if (n > 0) { changed = true; log(`project ratio -> ${RATIO}`); }
            else log(`WARNING: ${RATIO} not found in the Settings panel - ratio left as-is.`);
        }
        const cn = await setConfirmNever(page);
        log(`confirm-before-generating -> ${cn === 'clicked' ? 'Never (set)' : cn === 'already' ? 'Never (already)' : cn}`);
        if (cn === 'clicked') changed = true;
        if (changed) {
            const saved = await clickSave(page);
            log(saved ? 'settings saved' : 'WARNING: no Save button found - settings not saved');
        }
        await closeSettings(page);
        await wait(1500);   // let the panel's backdrop/animation finish
    } else {
        log('WARNING: could not open the Settings panel to check the image model.');
    }

    let made = 0, failed = 0;
    for (const r of refs) {
        const name = String(r.name || '').trim();
        log(`\n[${made + failed + 1}/${refs.length}] ${name}`);
        const before = await countTiles(page);
        log(`  tiles before: ${before}`);
        if (!await insertPrompt(page, String(r.prompt).trim())) { failed++; continue; }
        let click = await clickSubmit(page);
        for (let a = 2; a <= 6 && !click.ok; a++) { await wait(5000); click = await clickSubmit(page); }
        if (!click.ok) { log(`  could not submit: ${click.why}`); failed++; continue; }
        log(`  generating... (up to ${WAIT_S}s)`);
        const after = await waitForNewTile(page, before, WAIT_S);
        if (after <= before) { log(`  TIMEOUT - no new tile after ${WAIT_S}s`); failed++; continue; }
        log(`  new tile appeared (${before} -> ${after}); renaming to "${name}"`);
        const ren = await renameNewest(page, name);
        if (ren.ok) { made++; log(`  ok - tile renamed "${name}"`); }
        else { failed++; log(`  generated, but rename failed: ${ren.why}`); }
    }

    // Hand the chip back in the state the film run needs. agent_mode.js turns
    // Agent Mode ON itself, but leaving it OFF here means the next thing to touch
    // this project starts from the wrong state. --keep-agent-on opts out.
    if (KEEP_AGENT) {
        log('(--keep-agent-on: leaving Agent Mode as it was.)');
    } else {
        const on = await setAgent(page, true);
        log(on.ok
            ? 'Agent Mode is ON again, ready for the film run.'
            : `WARNING: could not turn Agent Mode back ON (${on.why}) - agent_mode.js will retry.`);
    }
    log(`\nDone: ${made} made, ${failed} failed, of ${refs.length}.`);
    log('Next: run agent_mode (or the MCP run_agent) with --no-upload-refs so it');
    log('@-mentions the tiles just made instead of uploading local files.');
    await browser.disconnect();
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });

module.exports = { refsPath, loadRefs, renameNewest, tileName, agentOn, setAgent };
