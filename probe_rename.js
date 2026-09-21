// probe_rename.js - read-only: open one tile's More-options -> Rename and dump
// the rename overlay DOM (inputs + buttons), pressing Escape without saving.
//
//   node probe_rename.js

const puppeteer = require('puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CDP = 'http://127.0.0.1:9222';

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages.find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow project tab open.'); process.exit(1); }
    console.log('page:', page.url());
    await page.keyboard.press('Escape');
    await wait(600);

    // 1. open the newest tile's More options
    const opened = await page.evaluate(() => {
        const more = [...document.querySelectorAll('button[aria-label="More options"]')]
            .filter(b => !b.closest('.header-right-container, .header-desktop-main-row')
                      && !!b.closest('[class*=hover-overlay]'));
        if (!more.length) return { ok: false, why: 'no tile' };
        more[0].scrollIntoView({ block: 'center' });
        more[0].click();
        return { ok: true, tiles: more.length };
    });
    console.log('opened menu:', JSON.stringify(opened));
    await wait(2000);

    // 2. click the Rename menu item
    const clicked = await page.evaluate(() => {
        const el = [...document.querySelectorAll('button.mat-mdc-menu-item, .item-text, [role="menuitem"]')]
            .find((x) => /^rename$/i.test((x.innerText || '').trim()));
        if (!el) return { ok: false, why: 'no Rename item' };
        el.click();
        return { ok: true, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60) };
    });
    console.log('clicked rename:', JSON.stringify(clicked));
    await wait(2500);

    // 3. dump every overlay + input + button on screen
    const dump = await page.evaluate(() => {
        const out = { overlays: [], inputs: [], buttons: [] };
        for (const p of document.querySelectorAll('.cdk-overlay-pane, [role="dialog"], [class*=overlay], [class*=rename]')) {
            const r = p.getBoundingClientRect();
            if (r.width < 30 || r.height < 15) continue;
            out.overlays.push({
                cls: String(p.className).slice(0, 90),
                text: (p.innerText || '').replace(/\n/g, ' | ').slice(0, 200),
            });
        }
        for (const i of document.querySelectorAll('input, textarea, [contenteditable="true"]')) {
            const r = i.getBoundingClientRect();
            out.inputs.push({
                tag: i.tagName.toLowerCase(),
                cls: String(i.className).slice(0, 80),
                type: i.getAttribute('type'),
                aria: i.getAttribute('aria-label'),
                ph: i.getAttribute('placeholder'),
                val: (i.value !== undefined ? i.value : i.innerText || '').slice(0, 40),
                vis: r.width > 0 && r.height > 0,
            });
        }
        for (const b of document.querySelectorAll('button')) {
            const r = b.getBoundingClientRect();
            if (r.width < 10 || r.height < 10) continue;
            const aria = b.getAttribute('aria-label') || '';
            const txt = (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30);
            if (aria || /done|save|rename|ok|cancel/i.test(txt)) {
                out.buttons.push({ cls: String(b.className).slice(0, 60), aria, txt });
            }
        }
        return out;
    });
    console.log('\n=== OVERLAYS ===');
    console.log(JSON.stringify(dump.overlays, null, 1));
    console.log('\n=== INPUTS ===');
    console.log(JSON.stringify(dump.inputs, null, 1));
    console.log('\n=== BUTTONS (aria/done/save) ===');
    console.log(JSON.stringify(dump.buttons, null, 1));

    await page.keyboard.press('Escape');
    await browser.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
