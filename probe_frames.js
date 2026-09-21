// probe_frames.js - read-only: does this Flow account offer an image-to-video
// (frames) mode, and what does the settings menu contain?
//
//   node probe_frames.js
//
// Opening a menu changes nothing. Nothing here clicks Generate or uploads.

const puppeteer = require('puppeteer');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const CDP = 'http://127.0.0.1:9222';

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages.find(p => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow project tab open.'); process.exit(1); }
    console.log('Flow tab:', page.url());

    // 1. Anything in the chrome that mentions a frame / image-to-video mode.
    const frames = await page.evaluate(() => {
        const desc = (el) => ({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString().slice(0, 70),
            aria: el.getAttribute('aria-label'),
            text: (el.innerText || el.textContent || '').trim().replace(/\n/g, ' | ').slice(0, 90),
            visible: (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
        });
        const kw = /frame|image to video|i2v|start|end frame|ingredient|reference/i;
        return [...document.querySelectorAll('button, [role="button"], [role="menuitem"], mat-list-item, [aria-label]')]
            .filter(el => kw.test((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '')))
            .map(desc)
            .filter((v, i, a) => a.findIndex(x => x.text === v.text && x.aria === v.aria) === i)
            .slice(0, 40);
    });
    console.log('\n=== chrome mentioning frames / image-to-video ===');
    frames.forEach(f => console.log(`   [${f.tag}] vis=${f.visible} aria="${f.aria}" "${f.text}"`));

    // 2. All visible buttons near the prompt box - the mode/settings controls live here.
    const buttons = await page.evaluate(() => {
        return [...document.querySelectorAll('button')]
            .map(b => ({
                aria: b.getAttribute('aria-label'),
                text: (b.innerText || '').trim().replace(/\n/g, ' ').slice(0, 50),
                cls: (b.className || '').toString().slice(0, 60),
                visible: (() => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
                y: Math.round(b.getBoundingClientRect().y),
            }))
            .filter(b => b.visible && (b.aria || b.text))
            .filter((v, i, a) => a.findIndex(x => x.aria === v.aria && x.text === v.text) === i);
    });
    console.log('\n=== every visible button (y-sorted) ===');
    buttons.sort((a, b) => a.y - b.y).forEach(b => console.log(`   y=${String(b.y).padStart(4)} aria="${b.aria}" text="${b.text}"`));

    // 3. Open the settings menu if one is offered, and dump it.
    const settingsBtn = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x =>
            /settings/i.test(x.getAttribute('aria-label') || ''));
        if (!b) return false;
        b.click();
        return true;
    });
    if (settingsBtn) {
        await wait(2000);
        const menu = await page.evaluate(() => {
            const out = [];
            for (const p of document.querySelectorAll('.cdk-overlay-pane, [role="menu"]')) {
                out.push({
                    text: (p.innerText || '').trim().replace(/\n/g, ' | ').slice(0, 900),
                    items: [...p.querySelectorAll('[role="menuitem"], mat-option, button, li')]
                        .map(el => (el.innerText || '').trim().replace(/\n/g, ' ').slice(0, 70))
                        .filter(Boolean),
                });
            }
            return out;
        });
        console.log('\n=== settings menu ===');
        menu.forEach(m => {
            console.log('text :', JSON.stringify(m.text));
            console.log('items:', m.items.join(' / '));
        });
        await page.keyboard.press('Escape');
        await wait(500);
    } else {
        console.log('\n(no button with aria "settings" on this page)');
    }

    await browser.disconnect();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
