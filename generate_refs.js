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
// The console sink, kept under its own name so generateRefs() below can shadow
// `log` with its caller's sink without losing this one.
const moduleLog = log;

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
// The video model this project should generate with ("Veo 3.1 - Fast",
// "Omni 1.1 Flash", ...). Empty means leave Flow's own setting alone.
const VIDEO_MODEL = typeof flag('--video-model') === 'string' ? flag('--video-model').trim() : '';
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
// Reading the refs is shared with the Scenes/Ingredients engine, so both routes
// cannot disagree about the cast or the place. See refs_for_scene.js.
const { readRefsFile, loadStoryRefs } = require('./refs_for_scene.js');

function loadRefs() {
    const f = refsPath();
    if (!f) { console.error('Give --story <folder> or --refs <refs.json>.'); process.exit(1); }
    if (REFS_FILE && !fs.existsSync(f)) {
        console.error(`No such refs file: ${f}`);
        process.exit(1);
    }
    let refs = [], source = '';
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        refs = readRefsFile(f);
        source = path.basename(f);
    } else {
        // No refs.json: loadStoryRefs falls back to the story's
        // character_sheets.txt, which older stories have instead.
        const loaded = loadStoryRefs(path.dirname(f), null);
        refs = loaded.refs;
        source = loaded.source;
        log(`No refs.json - read ${source} instead.`);
    }
    if (!refs.length) {
        console.error(`No reference images found for ${f}.`);
        console.error('Write the story first (`node write_story.js ...`), which writes refs.json.');
        process.exit(1);
    }
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
// Is the Settings panel actually on screen? Presence in the DOM is not the same
// thing - a closed panel's nodes can linger, and a hidden panel would then read
// as open forever.
async function settingsPanelOpen(page) {
    return await page.evaluate(() => {
        const el = document.querySelector('.settings-content, .settings-section');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return !!(r.width || r.height);
    });
}

// Is the FULL Settings panel open - the one with the generation-default
// sections and its Save button?
//
// `settingsPanelOpen` above answers the weaker question "are any of this
// panel's nodes on screen", which is all that closing it needs. Opening it
// needs the stronger one. The compact "Settings trigger" summary opens a quick
// view that carries no generation-default sections and no Save button, and
// reporting THAT as success is worse than reporting failure: the caller then
// reads the model rows, finds none, sets nothing, and walks away leaving the
// view sitting over the prompt bar - which is the state that keeps Start
// generation disabled. Save is also this drawer's only way out, so a panel
// without one must not be entered at all.
async function settingsPanelUsable(page) {
    return await page.evaluate(() => {
        const hasSave = !!document.querySelector('.settings-save-button')
            || [...document.querySelectorAll('button')].some((b) => {
                const src = b.querySelector('.mdc-button__label') || b;
                const c = src.cloneNode(true);
                c.querySelectorAll('mat-icon').forEach((i) => i.remove());
                return /^save$/i.test((c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim());
            });
        if (!hasSave) return false;
        const el = document.querySelector('.settings-content, .settings-section');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return !!(r.width || r.height);
    });
}

// The tune button ("Settings") opens the full Settings panel, which holds the
// Image and Video generation defaults. We read the image default to confirm the
// sheets will be images (Nano Banana) and not clips.
//
// Two different buttons carry a settings label and which one exists depends on
// the page state: the tune button ("Settings"), and a compact "Settings trigger"
// summary that is display:none on a fresh project. A run with Agent Mode off was
// seen with only "Settings trigger" present, so matching "Settings" exactly left
// the panel unopenable and - because the caller is `if (await openSettingsPanel)`
// - silently skipped the whole settings block. Try both labels and take the one
// that is actually visible: clicking a hidden button dispatches an event Angular
// ignores, which looks exactly like the panel refusing to open.
//
// Success means the USABLE panel, not just its container - see
// settingsPanelUsable above for why that distinction matters.
async function openSettingsPanel(page) {
    for (let i = 0; i < 3; i++) {
        const clicked = await page.evaluate(() => {
            const visible = (el) => {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                if (!r.width && !r.height) return false;
                const cs = getComputedStyle(el);
                return cs.display !== 'none' && cs.visibility !== 'hidden';
            };
            const byLabel = (n) => document.querySelector(`button[aria-label="${n}"]`);
            const cands = [
                byLabel('Settings'),
                byLabel('Settings trigger'),
                ...[...document.querySelectorAll('button')].filter((x) =>
                    /^settings(\s+trigger)?$/i.test((x.getAttribute('aria-label') || '').trim())),
            ];
            const b = cands.find(visible);
            if (!b) return false;
            b.click();
            return true;
        });
        if (!clicked) { await wait(1500); continue; }
        // Poll for the usable panel rather than waiting a fixed 2.2s: the
        // drawer mounts its contents a moment after its container, so a single
        // fixed read can catch a working panel mid-mount and call it empty.
        const t0 = Date.now();
        while ((Date.now() - t0) / 1000 < 8) {
            await wait(400);
            if (await settingsPanelUsable(page)) return true;
        }
        // Whatever opened is not the panel we came for. Back out the way that
        // has always worked, rather than leaving it up for the caller to trip
        // over.
        await page.keyboard.press('Escape');
        await wait(700);
    }
    return false;
}
// ---- the model dropdown in a "generation default" section ------------------
// Each generation-default section holds a Material dropdown: a button showing
// the current model with an arrow_drop_down icon at its end, and a menu of
// <span class="label"> items. The Image and the Video section each have one, so
// the trigger is always looked for INSIDE the named section - matching on the
// arrow alone would pick whichever section happened to come first, and setting
// the video model on the image row is a silent, expensive mistake.
//
// Icon ligatures ("arrow_drop_down", "crop_16_9") render as text, so a button's
// innerText is not its model name. Strip the icons rather than pattern-matching
// them away, so an icon Flow adds later does not quietly join the name.
const SECTION_OF = { image: 'image generation default', video: 'video generation default' };

// Flow also names both pickers outright, which is exact where the section scan
// has to infer: <button class="... video-model-picker-button" aria-label="Video
// generation default model">. Preferred when present, because it cannot pick the
// wrong row no matter how the section is laid out; the scan below is the
// fallback for a build without them.
//
// Both the class and the aria-label are matched because only the pair was
// verified live, and either could change independently.
const PICKER_OF = {
    image: '.image-model-picker-button, button[aria-label="Image generation default model"]',
    video: '.video-model-picker-button, button[aria-label="Video generation default model"]',
};

// Compare model names loosely: "Veo 3.1 - Fast" and "veo3.1-fast" are the same
// model, and the menu is not obliged to spell it the way the GUI does.
const modelKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function readSectionModel(page, which) {
    return await page.evaluate(({ heading, picker }) => {
        const strip = (el) => {
            const src = el.querySelector('.mdc-button__label') || el;
            const c = src.cloneNode(true);
            c.querySelectorAll('mat-icon').forEach((i) => i.remove());
            return (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim();
        };
        const direct = document.querySelector(picker);
        if (direct) return strip(direct) || null;
        const sec = [...document.querySelectorAll('.settings-section')]
            .find((s) => new RegExp(heading, 'i').test(s.innerText || ''));
        if (!sec) return null;
        const trig = [...sec.querySelectorAll('button')].find((b) =>
            [...b.querySelectorAll('mat-icon')].some((i) => /arrow_drop_down/.test(i.textContent || '')));
        // No arrow icon found: fall back to any button naming a model, which is
        // how this read the row before the dropdown shape was known.
        if (!trig) {
            return [...sec.querySelectorAll('button')]
                .map(strip)
                .find((t) => /nano|imagen|banana|veo|omni|flash/i.test(t)) || null;
        }
        return strip(trig) || null;
    }, { heading: SECTION_OF[which], picker: PICKER_OF[which] });
}
// Read just the model row under "Image generation default".
const readImageModel = (page) => readSectionModel(page, 'image');
const readVideoModel = (page) => readSectionModel(page, 'video');
const looksImageModel = (m) => /nano|imagen|banana/i.test(String(m));

// Pick a model in one of those dropdowns -> { ok, changed, why, model }.
// The menu renders in a CDK overlay outside the settings panel, so the item is
// searched for document-wide. The row is re-read afterwards rather than assumed:
// a click that lands nowhere leaves the old model in place, and generating a
// whole film on the wrong model is exactly what this is here to prevent.
async function setSectionModel(page, which, want) {
    const heading = SECTION_OF[which];
    const now = await readSectionModel(page, which);
    if (now && modelKey(now) === modelKey(want)) {
        return { ok: true, changed: false, why: 'already set', model: now };
    }
    const opened = await page.evaluate(({ h, picker }) => {
        // The named picker first - it cannot be the other section's dropdown.
        const direct = document.querySelector(picker);
        if (direct) { direct.click(); return true; }
        const sec = [...document.querySelectorAll('.settings-section')]
            .find((s) => new RegExp(h, 'i').test(s.innerText || ''));
        if (!sec) return false;
        const trig = [...sec.querySelectorAll('button')].find((b) =>
            [...b.querySelectorAll('mat-icon')].some((i) => /arrow_drop_down/.test(i.textContent || '')));
        if (!trig) return false;
        trig.click();
        return true;
    }, { h: heading, picker: PICKER_OF[which] });
    if (!opened) return { ok: false, changed: false, why: `no model dropdown in the ${which} section` };

    await wait(1200);
    const picked = await page.evaluate((name) => {
        const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const want = key(name);
        const items = [...document.querySelectorAll('.cdk-overlay-pane span.label, ' +
            '.cdk-overlay-pane [role="option"], mat-option, [role="listbox"] [role="option"]')];
        const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        // Exact on the loose key first: "Veo 3.1 - Lite" must not win over
        // "Veo 3.1 - Lite [Lower Priority]" just by being shorter.
        const hit = items.find((el) => key(text(el)) === want)
            || items.find((el) => key(text(el)).startsWith(want));
        if (!hit) return false;
        const clickable = hit.closest('[role="option"], mat-option, button, li') || hit;
        clickable.click();
        return true;
    }, want);
    if (!picked) {
        await page.keyboard.press('Escape');
        await wait(500);
        return { ok: false, changed: false, why: `"${want}" is not in the ${which} model menu` };
    }

    await wait(900);
    const after = await readSectionModel(page, which);
    if (modelKey(after) !== modelKey(want)) {
        return { ok: false, changed: true, why: `clicked "${want}" but the row reads "${after}"`, model: after };
    }
    return { ok: true, changed: true, why: 'picked', model: after };
}
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
        // Read the label span rather than the button's own text: Material renders
        // an icon's ligature ("check", "save") as text, so a button carrying one
        // would read "checkSave" and an exact match on "Save" would miss it. The
        // live button is <button class="settings-save-button"><span
        // class="mdc-button__label"> Save </span></button> - the padding is why
        // the comparison trims.
        const text = (el) => {
            const src = el.querySelector('.mdc-button__label') || el;
            const c = src.cloneNode(true);
            c.querySelectorAll('mat-icon').forEach((i) => i.remove());
            return (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim();
        };
        const b = document.querySelector('.settings-save-button')
            || [...document.querySelectorAll('button')].find((x) => /^save$/i.test(text(x)));
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
        // The option is a container holding the label AND a subtext ("Agent will
        // generate media and spend credits automatically"), so the whole
        // element's text is never just "Never". Read the label span when there is
        // one; \b rather than $ because the subtext may still be inside it.
        const never = [...sec.querySelectorAll('[role="radio"], button')].find((el) => {
            const lbl = el.querySelector('.radio-label');
            const t = ((lbl ? lbl.innerText : el.innerText) || '').trim();
            return /^never\b/i.test(t);
        });
        if (!never) return 'no-never';
        if (never.getAttribute('aria-checked') === 'true') return 'already';
        never.click();
        return 'clicked';
    });
}
// The panel leaves a backdrop that keeps Start generation disabled until it is
// really gone, so wait it out rather than assuming one Escape is enough.
// Dismiss the Settings panel WITHOUT writing anything.
//
// This panel is a drawer inside the agent panel - <flow-agent-panel> >
// .agent-panel-content > flow-settings-view > .container > .settings-content -
// and on the build it was measured on it has exactly ONE way out: Save.
//
// Save COMMITS, so closing is a write. It is the project's own settings being
// written back, so it is a no-op when nothing was changed - but it is still a
// write, and the way to get the drawer out of the way of the prompt bar.
//
// Save is TRIED FIRST, and Escape is kept as the fallback. That order matters:
// a build can show a settings view with no Save button in it at all, and then
// Save-only closing reports failure every time and leaves the drawer up - which
// is exactly the state that keeps Start generation disabled, so every ref after
// it fails with the prompt sitting in the box. Escape and a click on empty
// space are what closed this drawer before Save was used, and they still do.
async function closeSettings(page, seconds = 6) {
    if (!await settingsPanelOpen(page)) return true;
    await clickSave(page);
    // The drawer animates out, so poll for it instead of guessing a delay: a
    // fixed 1200ms was measured as too short and made this report failure on a
    // panel that was already on its way out.
    const t0 = Date.now();
    while ((Date.now() - t0) / 1000 < seconds) {
        await wait(300);
        if (!await settingsPanelOpen(page)) return true;
    }
    // Save did not do it - no Save button on this build, or it did not take.
    for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Escape');
        await wait(800);
        if (!await settingsPanelOpen(page)) return true;
    }
    await page.mouse.click(5, 5);
    await wait(700);
    return !(await settingsPanelOpen(page));
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
// Submit with a REAL mouse click at the button's centre - never el.click().
//
// el.click() dispatches a synthetic DOM event carrying isTrusted:false, and
// Flow's Angular handler ignores it. The click throws nothing, so this used to
// return ok:true - while the prompt sat in the box untouched. That is the exact
// signature of the failure: a run reports "0 made, N failed" and there is NO
// "could not submit" line anywhere in the log, because as far as this function
// was concerned the submit had worked.
//
// Measured live on this build: el.click() on the button -> the prompt box still
// holds its 282 characters after the full 180s wait and no tile ever appears.
// page.mouse.click() at the same coordinates -> the box clears within 7s and the
// tiles appear. The mention picker and the picker's own rows already click by
// coordinate for this same reason; the submit was the one left on the synthetic
// path.
async function clickSubmit(page) {
    const where = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')]
            .find((x) => /start generation/i.test(x.getAttribute('aria-label') || ''));
        if (!b) return { ok: false, why: 'no Start generation button' };
        if (b.disabled || String(b.className).includes('disabled')) return { ok: false, why: 'Start generation is disabled' };
        const r = b.getBoundingClientRect();
        if (!r.width || !r.height) return { ok: false, why: 'Start generation is not on screen' };
        return { ok: true, cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
    });
    if (!where.ok) return where;
    await page.mouse.click(where.cx, where.cy);
    return { ok: true };
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
// ── the routine ──────────────────────────────────────────────────────────────
// Exported so the Scenes/Ingredients engine can make the sheets on a page it has
// already opened, in the project it is about to generate in - that is the whole
// port, only the caller differs. `page` must be a Flow PROJECT page.
// Returns { made, failed, total }.
async function generateRefs(page, refs, opts = {}) {
    // Shadowing `log` with the caller's sink; the body's log() calls need no
    // change for it.
    const log = opts.log || moduleLog;
    const waitS = opts.waitS || WAIT_S;
    const ratio = opts.ratio !== undefined ? opts.ratio : RATIO;
    const videoModel = opts.videoModel !== undefined ? opts.videoModel : VIDEO_MODEL;
    const keepAgentOn = opts.keepAgentOn !== undefined ? opts.keepAgentOn : KEEP_AGENT;

    log(`${refs.length} reference image(s) to make:`);
    refs.forEach((r) => log(`  - ${r.name}  (${r.kind || 'ref'})`));
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
        if (ratio && !/^(flow|auto|default|none)$/i.test(ratio)) {
            const n = await setPanelRatio(page, ratio);
            if (n > 0) { changed = true; log(`project ratio -> ${ratio}`); }
            else log(`WARNING: ${ratio} not found in the Settings panel - ratio left as-is.`);
        }
        const cn = await setConfirmNever(page);
        log(`confirm-before-generating -> ${cn === 'clicked' ? 'Never (set)' : cn === 'already' ? 'Never (already)' : cn}`);
        if (cn === 'clicked') changed = true;
        // The model the film will be generated with. It is saved into the project
        // here, in the same panel visit as the ratio, so it is already right by
        // the time the agent step reaches the Generate button. Setting it is the
        // whole point: Flow remembers the last model used per project, so left
        // alone a project quietly keeps whatever was picked last time.
        if (videoModel) {
            const vm = await setSectionModel(page, 'video', videoModel);
            if (vm.ok) {
                if (vm.changed) changed = true;
                log(`video generation default -> ${vm.model}${vm.changed ? '' : ' (already)'}`);
            } else {
                log(`WARNING: could not set the video model to "${videoModel}" (${vm.why}) -`);
                log('the film will generate with whatever Flow has selected.');
            }
        }
        if (changed) {
            const saved = await clickSave(page);
            log(saved ? 'settings saved' : 'WARNING: no Save button found - settings not saved');
        }
        // Save is also the only way to close this drawer, so even a visit that
        // changed nothing writes the project's own settings back unchanged. Left
        // open it covers part of the prompt bar and the sheet prompts miss.
        if (!await closeSettings(page)) {
            log('WARNING: the Settings panel would not close. It covers part of the');
            log('prompt bar, so the sheet prompts may not land - close it by hand.');
        }
        await wait(1500);   // let the panel's backdrop/animation finish
    } else {
        log('WARNING: could not open the Settings panel. Not checked or applied:');
        log('  the image model (sheets may come out as clips), the project ratio,');
        log(`  confirm-before-generating,${videoModel ? ` and the video model ("${videoModel}") -` : ' -'}`);
        log('  the film will generate with whatever Flow has selected.');
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
        log(`  generating... (up to ${waitS}s)`);
        const after = await waitForNewTile(page, before, waitS);
        if (after <= before) { log(`  TIMEOUT - no new tile after ${waitS}s`); failed++; continue; }
        log(`  new tile appeared (${before} -> ${after}); renaming to "${name}"`);
        const ren = await renameNewest(page, name);
        if (ren.ok) { made++; log(`  ok - tile renamed "${name}"`); }
        else { failed++; log(`  generated, but rename failed: ${ren.why}`); }
    }

    // Hand the chip back in the state the film run needs. agent_mode.js turns
    // Agent Mode ON itself, but leaving it OFF here means the next thing to touch
    // this project starts from the wrong state. --keep-agent-on opts out.
    if (keepAgentOn) {
        log('(--keep-agent-on: leaving Agent Mode as it was.)');
    } else {
        const on = await setAgent(page, true);
        log(on.ok
            ? 'Agent Mode is ON again, ready for the film run.'
            : `WARNING: could not turn Agent Mode back ON (${on.why}) - agent_mode.js will retry.`);
    }
    log(`\nDone: ${made} made, ${failed} failed, of ${refs.length}.`);
    return { made, failed, total: refs.length };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) (async () => {
    const refs = loadRefs();
    if (DRY) { log(`${refs.length} reference image(s) would be made - --dry: nothing generated.`); return; }

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

    const r = await generateRefs(page, refs, {
        waitS: WAIT_S, ratio: RATIO, videoModel: VIDEO_MODEL, keepAgentOn: KEEP_AGENT,
    });
    log('Next: run agent_mode (or the MCP run_agent) with --no-upload-refs so it');
    log('@-mentions the tiles just made instead of uploading local files.');
    await browser.disconnect();
    process.exit(r.failed ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });

module.exports = {
    refsPath, loadRefs, renameNewest, tileName, agentOn, setAgent,
    readSectionModel, readImageModel, readVideoModel, setSectionModel,
    setConfirmNever, modelKey, SECTION_OF, PICKER_OF,
    // The Settings-panel plumbing, so agent_mode.js can set the video model in
    // the same place and the same way this does.
    openSettingsPanel, closeSettings, settingsPanelOpen, clickSave, setPanelRatio,
};
