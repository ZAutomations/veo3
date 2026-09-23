#!/usr/bin/env node
/**
 * PROBE THE INGREDIENT PICKER (read-only)
 * =======================================
 * Answers one question that cannot be answered from the code or from disk:
 * when the "+ Add ingredients to the prompt box" picker is ticked, WHY does only
 * one of the two characters end up attached?
 *
 * Two shapes would both produce that symptom, and they need opposite fixes:
 *
 *   A. the list is SINGLE-SELECT - ticking the second row replaces the first,
 *      so the second click silently un-ticks the first;
 *   B. the list CLOSES on the first tick - the second lookup finds no picker at
 *      all, and "Add to prompt" is never pressed.
 *
 * selectRefsForScene now reads the prompt box back and retries, which converges
 * either way - but this says which one it actually is, so the log stops being
 * the only evidence.
 *
 * It clicks rows IN the picker and then presses Escape. It does NOT press "Add
 * to prompt", so it attaches nothing and generates nothing: no credits, no
 * change to the project. Run it while the automation browser is idle - not
 * during a run.
 *
 * Usage:  node probe_ref_picker.js [--cdp 9222]
 */

const puppeteer = require('puppeteer');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
function flag(name, def) {
    const i = argv.indexOf(name);
    if (i < 0) return def;
    const v = argv[i + 1];
    return (v && !v.startsWith('--')) ? v : true;
}
const CDP_PORT = String(flag('--cdp', '9222'));

const DUMP = () => {
    const vp = document.querySelector('cdk-virtual-scroll-viewport[aria-label="Asset list"]')
            || document.querySelector('.asset-list-viewport');
    const items = vp ? [...vp.querySelectorAll('button.asset-item')] : [];
    const box = document.querySelector('.ProseMirror[contenteditable="true"]')
            || [...document.querySelectorAll('[contenteditable="true"]')].pop();
    const overlay = document.querySelector('.cdk-overlay-container');
    const addBtn = overlay ? [...overlay.querySelectorAll('button')]
        .find(x => /add to prompt/i.test(x.innerText || x.getAttribute('aria-label') || '')) : null;
    return {
        pickerOpen: !!vp,
        multiselect: vp ? vp.getAttribute('aria-multiselectable') : null,
        // Whether the viewport is actually on screen matters: a closed picker's
        // nodes can linger in the DOM and would read as open forever.
        visible: vp ? !!(vp.getBoundingClientRect().width || vp.getBoundingClientRect().height) : false,
        items: items.map(b => {
            const t = b.querySelector('.asset-title');
            return {
                title: t ? (t.textContent || '').trim() : (b.innerText || '').trim(),
                selected: b.getAttribute('aria-selected'),
                checked: !!b.querySelector('[aria-checked="true"], .checked, mat-checkbox-checked'),
            };
        }),
        addToPrompt: addBtn ? { found: true, disabled: !!addBtn.disabled } : { found: false },
        promptText: box ? (box.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300) : null,
        chips: box ? [...box.querySelectorAll('[class*=mention], [class*=chip], [class*=ingredient], [data-mention]')]
            .map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean) : [],
    };
};

(async () => {
    let browser;
    try {
        browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}`, defaultViewport: null });
    } catch (e) {
        console.error(`Could not connect to Chrome on CDP port ${CDP_PORT}. Start the automation browser first.`);
        process.exit(1);
    }
    const page = (await browser.pages()).find(p => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow PROJECT tab open.'); await browser.disconnect(); process.exit(1); }
    console.log(`Project: ${page.url()}\n`);

    const before = await page.evaluate(DUMP);
    console.log('--- before opening the picker ---');
    console.log(JSON.stringify({ promptText: before.promptText, chips: before.chips }, null, 2));

    const opened = await page.evaluate(() => {
        const b = document.querySelector('button[aria-label="Add ingredients to the prompt box"]')
               || [...document.querySelectorAll('button')].find(x =>
                    (x.getAttribute('aria-label') || '').includes('Add ingredients'));
        if (!b) return false;
        b.click();
        return true;
    });
    if (!opened) {
        console.log('\nNo "+ Add ingredients to the prompt box" button on this page.');
        console.log('Open the scene editor (or the project grid with a prompt box) and re-run.');
        await browser.disconnect();
        process.exit(1);
    }
    await wait(2500);

    const dump = await page.evaluate(DUMP);
    console.log('\n--- the picker, as it really is ---');
    console.log(`picker open        : ${dump.pickerOpen}  (on screen: ${dump.visible})`);
    console.log(`aria-multiselectable: ${JSON.stringify(dump.multiselect)}`);
    console.log(`rows               : ${dump.items.length}`);
    dump.items.slice(0, 12).forEach((it, i) =>
        console.log(`  [${i}] "${it.title}"  selected=${it.selected} checked=${it.checked}`));
    console.log(`"Add to prompt"    : ${JSON.stringify(dump.addToPrompt)}`);
    if (!dump.items.length) {
        console.log('\nNo rows to tick. The picker holds no assets for this project.');
        await page.keyboard.press('Escape');
        await browser.disconnect();
        process.exit(0);
    }

    // Tick the first two rows, reading the picker after EACH tick. This is the
    // measurement: A and B above look identical at the end and quite different
    // here.
    const marks = [];
    for (let i = 0; i < Math.min(2, dump.items.length); i++) {
        const title = dump.items[i].title;
        const clicked = await page.evaluate((idx) => {
            const vp = document.querySelector('cdk-virtual-scroll-viewport[aria-label="Asset list"]')
                    || document.querySelector('.asset-list-viewport');
            if (!vp) return 'no-picker';
            const items = [...vp.querySelectorAll('button.asset-item')];
            if (!items[idx]) return 'no-row';
            items[idx].click();
            return 'clicked';
        }, i);
        await wait(1200);
        const after = await page.evaluate(DUMP);
        marks.push({ ticked: title, clicked, ...after });
        console.log(`\n--- after ticking "${title}" (${clicked}) ---`);
        console.log(`picker open: ${after.pickerOpen}  "Add to prompt": ${JSON.stringify(after.addToPrompt)}`);
        after.items.slice(0, 12).forEach((it, k) =>
            console.log(`  [${k}] "${it.title}"  selected=${it.selected} checked=${it.checked}`));
        console.log(`prompt box : ${JSON.stringify(after.promptText)}`);
        console.log(`chips      : ${JSON.stringify(after.chips)}`);
    }

    console.log('\n================ VERDICT ================');
    const closed = marks.some(m => !m.pickerOpen);
    const lost = marks.length === 2 && marks[1].items.length
        && !marks[1].items.some(it => it.selected === 'true' || it.checked)
        && marks[0].items.length;
    const stillBoth = marks.length === 2 && marks[1].items
        && marks[1].items.filter(it => it.selected === 'true' || it.checked).length >= 2;
    if (closed) {
        console.log('B. The picker CLOSES on the first tick. Only one ingredient can ever be');
        console.log('   attached per open, so the fix is to re-open it per ingredient -');
        console.log('   which is what selectRefsForScene now does, up to 4 rounds.');
    } else if (stillBoth) {
        console.log('NEITHER. Both rows stayed ticked, so the list IS multi-select and the');
        console.log('   lost ref came from the lookup or the Add-to-prompt click instead.');
        console.log('   selectRefsForScene still catches it, because it reads the prompt');
        console.log('   box back rather than counting ticks.');
    } else if (lost) {
        console.log('A. The picker is SINGLE-SELECT. The second tick replaced the first, so');
        console.log('   whichever row is ticked last is the only one attached. The fix is to');
        console.log('   attach one per round and read the box back between rounds - also what');
        console.log('   selectRefsForScene now does.');
    } else {
        console.log('Inconclusive - only one row existed to tick.');
    }
    console.log('\nNothing was attached and nothing was generated (Escape, no "Add to prompt").');

    await page.keyboard.press('Escape');
    await wait(500);
    await page.keyboard.press('Escape');
    await browser.disconnect();
})().catch(async (e) => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });
