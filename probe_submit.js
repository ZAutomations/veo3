#!/usr/bin/env node
/**
 * SUBMIT PROBE
 * ============
 * Answers ONE question in about a minute, without spending a single credit:
 *
 *   Why does "Start generation" never get clicked?
 *
 * Why it exists. A batch can die with "Done: 0 made, 3 failed, of 3" while an
 * MCP tail keeps only the last two lines of output - so the one line that says
 * WHY ("could not submit: Start generation is disabled") is the first thing
 * lost. The engine has three very different ways to fail at that point:
 *
 *   1. "prompt did not land in the box"  - the text never reached ProseMirror
 *   2. "no Start generation button"      - the button was renamed again
 *   3. "Start generation is disabled"    - the text landed but Flow never
 *                                          enabled the button
 *
 * Case 3 is the one that produces the confusing report "the prompt is sitting
 * in the box on screen and nothing happened", and it is the one this probe is
 * built to prove.
 *
 * WHAT IT DOES. Two passes, and it NEVER clicks "Start generation", so nothing
 * is generated and nothing is spent:
 *
 *   PASS A  types a harmless throwaway string into the prompt box and watches
 *           whether the button enables - the baseline.
 *   PASS B  clears the box, runs the SAME Settings-panel visit the engine runs
 *           before it starts a batch (open -> read the models -> set
 *           confirm-before-generating -> Save -> close), reports whether the
 *           drawer actually closed, then types the same string and watches the
 *           button again.
 *
 * If the button enables in A and stays disabled in B, the Settings visit is
 * what breaks submission, and no amount of retrying the click will help.
 *
 * Run it with the automation browser open (START_CHROME_CDP.bat), signed in,
 * sitting on a Flow project:
 *
 *   node probe_submit.js [--cdp 9222] [--keep-text]
 *
 * It writes logs/submit_probe_<timestamp>.json and clears the box before exit
 * unless --keep-text is given.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
// The engine's OWN settings code, not a copy of it - so this probe tests what
// actually runs. Safe to require: generate_refs.js works only under
// `require.main === module`.
const GR = require('./generate_refs.js');

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const CDP = `http://127.0.0.1:${arg('--cdp', '9222')}`;
const KEEP_TEXT = process.argv.includes('--keep-text');
const TEST_TEXT = 'probe_submit test string - never submitted, only used to watch the button';

// Exactly the selectors the engine uses.
const BOX_SEL = 'flow-base-prompt-box .ProseMirror, .ProseMirror, [contenteditable="true"]';
const GEN_SEL = 'button[aria-label="Start generation"]';

// `vis` matters as much as `disabled`: a hidden clone carrying the same
// aria-label is the classic reason a .find() grabs a disabled button while an
// enabled one sits next to it on screen.
const READ_STATE = ({ boxSel, genSel }) => {
    const box = document.querySelector(boxSel);
    const all = [...document.querySelectorAll(genSel)].map(b => {
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        return {
            disabledAttr: b.disabled === true,
            clsDisabled: /disabled/.test((b.className || '').toString()),
            vis: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
    });
    const settingsEl = document.querySelector('.settings-content, .settings-section');
    let settingsVisible = false;
    if (settingsEl) {
        const r = settingsEl.getBoundingClientRect();
        settingsVisible = !!(r.width || r.height);
    }
    return {
        text_len: box ? (box.innerText || box.textContent || '').trim().length : -1,
        gen_count: all.length,
        any_enabled: all.some(b => b.vis && !b.disabledAttr && !b.clsDisabled),
        gen_buttons: all,
        overlay_open: !!document.querySelector('.cdk-overlay-container')
            && document.querySelector('.cdk-overlay-container').children.length > 0,
        settings_visible: settingsVisible,
        save_button: (() => {
            if (!document.querySelector('.settings-save-button')
                && ![...document.querySelectorAll('button')].some(b =>
                    /^save$/i.test((() => {
                        const s = b.querySelector('.mdc-button__label') || b;
                        const c = s.cloneNode(true);
                        c.querySelectorAll('mat-icon').forEach(i => i.remove());
                        return (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim();
                    })()))) return 'none';
            return document.querySelector('.settings-save-button') ? '.settings-save-button' : 'save-labelled';
        })(),
    };
};

const readState = (page) => page.evaluate(READ_STATE, { boxSel: BOX_SEL, genSel: GEN_SEL });

async function focusBox(page) {
    await page.evaluate((s) => { const b = document.querySelector(s); if (b) b.focus(); }, BOX_SEL);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await wait(400);
}

// Type exactly the way the engine's insertPrompt does: focus, select-all,
// clear, then a CDP Input.insertText through the real input pipeline.
async function typeLikeEngine(page, text) {
    await focusBox(page);
    const client = (typeof page.createCDPSession === 'function')
        ? await page.createCDPSession() : await page.target().createCDPSession();
    await client.send('Input.insertText', { text });
    await client.detach().catch(() => {});
    await wait(700);
}

// Poll until the button enables or the time runs out, keeping every state
// change so a button that enables LATE is not reported as never enabling.
async function watchButton(page, seconds) {
    const t0 = Date.now();
    const seen = [];
    let last = null;
    const tick = async () => {
        const s = await readState(page);
        const key = JSON.stringify([s.any_enabled, s.text_len, s.overlay_open, s.settings_visible]);
        if (key !== last) { last = key; seen.push({ t: +((Date.now() - t0) / 1000).toFixed(1), ...s }); }
        return s;
    };
    let s = await tick();
    while ((Date.now() - t0) / 1000 < seconds && !s.any_enabled) {
        await wait(1000);
        s = await tick();
    }
    return { enabled: s.any_enabled, log: seen.map(({ gen_buttons, ...r }) => r) };
}

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages.find(p => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) {
        console.error('No Flow project tab open. Open one in the automation browser.');
        for (const p of pages) console.error('  ' + (p.url() || '(blank)'));
        process.exit(1);
    }
    console.log('Project tab:', page.url());
    const report = { probed_at: new Date().toISOString(), url: page.url() };

    const idle = await readState(page);
    report.idle = idle;
    console.log('\n--- idle, nothing typed ---');
    console.log(`prompt box           : ${idle.text_len} chars`);
    console.log(`Start generation     : ${idle.gen_count} match(es), ${idle.any_enabled ? 'one is ENABLED' : 'all DISABLED'}`);
    console.log(`settings drawer open : ${idle.settings_visible}`);
    console.log(`save button found    : ${idle.save_button}`);

    if (!idle.gen_count) {
        report.verdict = 'NO START GENERATION BUTTON';
        save();
        console.log('\nVERDICT: NO START GENERATION BUTTON - it has been renamed again.');
        return;
    }

    // ---- PASS A: baseline, no Settings visit ------------------------------
    console.log('\n--- PASS A: type a test string, no Settings visit ---');
    await typeLikeEngine(page, TEST_TEXT);
    const landedA = (await readState(page)).text_len;
    const a = await watchButton(page, 20);
    report.pass_a = { landed: landedA, ...a };
    console.log(`text landed          : ${landedA} chars`);
    console.log(`button enabled       : ${a.enabled ? 'YES' : 'NO'}`);
    for (const s of a.log) {
        console.log(`   t+${String(s.t).padStart(4)}s  enabled=${s.any_enabled}  text=${s.text_len}  overlay=${s.overlay_open}  drawer=${s.settings_visible}`);
    }

    // ---- PASS B: the engine's Settings visit, then the same test ----------
    console.log('\n--- PASS B: the engine\'s Settings visit, then the same test ---');
    await focusBox(page);
    const opened = await GR.openSettingsPanel(page);
    report.settings_opened = opened;
    console.log(`openSettingsPanel    : ${opened}`);
    if (opened) {
        report.image_model = await GR.readImageModel(page).catch(e => 'ERROR ' + e.message);
        report.video_model = await GR.readVideoModel(page).catch(e => 'ERROR ' + e.message);
        console.log(`image model row      : ${report.image_model}`);
        console.log(`video model row      : ${report.video_model}`);
        report.open_state = await readState(page);
        console.log(`drawer visible       : ${report.open_state.settings_visible}`);
        console.log(`save button found    : ${report.open_state.save_button}`);
        report.confirm_never = await GR.setConfirmNever(page).catch(e => 'ERROR ' + e.message);
        console.log(`confirm-never        : ${report.confirm_never}`);
        report.click_save_ok = await GR.clickSave(page).catch(e => false);
        console.log(`clickSave() returned : ${report.click_save_ok}`);
    }
    const closed = await GR.closeSettings(page);
    report.close_settings_ok = closed;
    report.after_close = await readState(page);
    console.log(`closeSettings()      : ${closed ? 'closed' : 'STILL OPEN'}`);
    console.log(`drawer after close   : ${report.after_close.settings_visible}`);
    console.log(`overlay after close  : ${report.after_close.overlay_open}`);

    await typeLikeEngine(page, TEST_TEXT);
    const landedB = (await readState(page)).text_len;
    const b2 = await watchButton(page, 25);
    report.pass_b = { landed: landedB, ...b2 };
    console.log(`text landed          : ${landedB} chars`);
    console.log(`button enabled       : ${b2.enabled ? 'YES' : 'NO'}`);
    for (const s of b2.log) {
        console.log(`   t+${String(s.t).padStart(4)}s  enabled=${s.any_enabled}  text=${s.text_len}  overlay=${s.overlay_open}  drawer=${s.settings_visible}`);
    }

    // ---- leave the page as we found it -----------------------------------
    if (!KEEP_TEXT) {
        await focusBox(page);
        const cleared = await readState(page);
        report.cleared_to = cleared.text_len;
        console.log(`\nbox cleared -> ${cleared.text_len} chars left`);
    } else {
        console.log('\n--keep-text: leaving the test string in the box.');
    }
    if ((await readState(page)).settings_visible) {
        console.log('A drawer is still open - attempting to dismiss it...');
        await page.keyboard.press('Escape').catch(() => {});
        await wait(700);
        await GR.closeSettings(page).catch(() => {});
        report.left_open = (await readState(page)).settings_visible;
        console.log(report.left_open
            ? 'STILL OPEN - close it by hand before running a batch.'
            : 'dismissed.');
    }

    const verdict = a.enabled && !b2.enabled
        ? 'SETTINGS VISIT BREAKS SUBMIT'
        : (a.enabled && b2.enabled) ? 'SUBMIT WORKS IN BOTH PASSES'
        : (!a.enabled && !b2.enabled) ? 'BUTTON NEVER ENABLES AT ALL'
        : 'BASELINE ALREADY BROKEN';
    report.verdict = verdict;
    save();

    console.log('\n' + '='.repeat(70));
    console.log(`VERDICT: ${verdict}`);
    console.log('='.repeat(70));
    if (verdict === 'SETTINGS VISIT BREAKS SUBMIT') {
        console.log('Proven. The button enables on its own, and the Settings visit the');
        console.log('engine runs BEFORE a batch is what stops it enabling. Retrying the');
        console.log('click can never work - the button is disabled, not missed.');
        console.log('');
        console.log(`closeSettings() reported: ${report.close_settings_ok ? 'closed' : 'STILL OPEN'}`);
        console.log(`clickSave() found a Save : ${report.click_save_ok}`);
        if (!report.click_save_ok) {
            console.log('=> No Save button was found, so the old Escape fallback is needed.');
        } else if (!report.close_settings_ok) {
            console.log('=> Save was clicked but the drawer did not go away.');
        }
    } else if (verdict === 'SUBMIT WORKS IN BOTH PASSES') {
        console.log('The button enables in both passes, so submission is not broken on');
        console.log('this page right now. Reproduce the failing run and keep the FULL');
        console.log('output - the reason is on the line above "Done:" which the MCP tail');
        console.log('cuts off.');
    } else if (verdict === 'BUTTON NEVER ENABLES AT ALL') {
        console.log('The text reaches the box but the button never enables even with no');
        console.log('Settings visit - so this is not the Settings panel. Check whether a');
        console.log('dialog or overlay is up, and whether the project is out of credits.');
    } else {
        console.log('The button was already disabled before anything ran. Close any open');
        console.log('dialog on the Flow page and re-run.');
    }
    console.log('\nWrote ' + report.__file);
    browser.disconnect();

    function save() {
        fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        report.__file = path.join(__dirname, 'logs', `submit_probe_${stamp}.json`);
        fs.writeFileSync(report.__file, JSON.stringify(report, null, 2), 'utf8');
    }
})().catch(e => { console.error('Probe failed:', e.message); process.exit(1); });
