// probe_gen_settings.js - read-only: open the GENERATION settings menu (the
// tune icon next to the prompt box) and dump it.
//
//   node probe_gen_settings.js
//
// This is the menu that holds model / aspect ratio / frame options. Opening it
// changes nothing. Nothing is submitted.

const puppeteer = require('puppeteer');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const CDP = 'http://127.0.0.1:9222';

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages.find(p => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow project tab open.'); process.exit(1); }
    console.log('Flow tab:', page.url());

    // The tune icon sits in .agent-footer-actions next to Start generation.
    // Match on the icon text, not on /settings/i - the grid has its own
    // "Tile grid settings" button and that one wins a loose match.
    const opened = await page.evaluate(() => {
        const cands = [...document.querySelectorAll('button')].filter(b =>
            (b.innerText || '').trim() === 'tune' ||
            /^settings$/i.test((b.getAttribute('aria-label') || '').trim()));
        if (!cands.length) return { ok: false, why: 'no tune button' };
        const b = cands[0];
        b.scrollIntoView({ block: 'center' });
        b.click();
        return { ok: true, aria: b.getAttribute('aria-label'), text: b.innerText.trim() };
    });
    console.log('opened settings:', JSON.stringify(opened));
    await wait(2500);

    const menu = await page.evaluate(() => {
        const out = [];
        for (const p of document.querySelectorAll('.cdk-overlay-pane, [role="menu"], [role="dialog"]')) {
            const r = p.getBoundingClientRect();
            if (r.width < 40 || r.height < 20) continue;
            out.push({
                text: (p.innerText || '').trim().replace(/\n/g, ' | ').slice(0, 1200),
                items: [...p.querySelectorAll('[role="menuitem"], mat-option, button, li, [role="radio"], [role="switch"]')]
                    .map(el => ({
                        tag: el.tagName.toLowerCase(),
                        role: el.getAttribute('role'),
                        checked: el.getAttribute('aria-checked') || el.getAttribute('aria-selected'),
                        text: (el.innerText || '').trim().replace(/\n/g, ' ').slice(0, 60),
                    }))
                    .filter(x => x.text),
            });
        }
        return out;
    });

    console.log('\n=== settings pane(s) ===');
    menu.forEach((m, i) => {
        console.log(`--- pane ${i} ---`);
        console.log('text :', JSON.stringify(m.text));
        console.log('items:');
        m.items.forEach(it => console.log(`   [${it.tag}${it.role ? ' role=' + it.role : ''}${it.checked ? ' checked=' + it.checked : ''}] "${it.text}"`));
    });
    if (!menu.length) console.log('(no pane rendered - the button may not be the right one)');

    // Anything anywhere on the page that offers a frame / image input.
    const frames = await page.evaluate(() => {
        const kw = /frame|start image|first frame|last frame|upload|image input|drop/i;
        return [...document.querySelectorAll('button, [role="button"], input, [aria-label]')]
            .filter(el => kw.test((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '')))
            .map(el => ({
                tag: el.tagName.toLowerCase(),
                aria: el.getAttribute('aria-label'),
                type: el.getAttribute('type'),
                text: (el.innerText || '').trim().slice(0, 50),
            }))
            .filter((v, i, a) => a.findIndex(x => x.aria === v.aria && x.text === v.text) === i)
            .slice(0, 25);
    });
    console.log('\n=== frame/image affordances on the page ===');
    frames.forEach(f => console.log(`   [${f.tag}${f.type ? ' type=' + f.type : ''}] aria="${f.aria}" "${f.text}"`));

    await page.keyboard.press('Escape');
    await wait(400);
    await browser.disconnect();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
