// probe_model.js - read-only: open the prompt-bar Settings trigger and dump the
// model/aspect menu, so generate_refs can select an IMAGE model itself.
//   node probe_model.js

const puppeteer = require('puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CDP = 'http://127.0.0.1:9222';

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    const page = (await browser.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow project tab open.'); process.exit(1); }
    console.log('page:', page.url());
    await page.keyboard.press('Escape');
    await wait(600);

    const trig = await page.evaluate(() => {
        const cands = [...document.querySelectorAll('button')].filter(b => {
            const t = (b.innerText || '').trim();
            return /settings trigger/i.test(b.getAttribute('aria-label') || '') || /·/.test(t) && /video|image/i.test(t);
        });
        if (!cands.length) return { ok: false };
        const b = cands[0];
        b.scrollIntoView({ block: 'center' });
        b.click();
        return { ok: true, aria: b.getAttribute('aria-label'), text: (b.innerText || '').trim().slice(0, 60) };
    });
    console.log('trigger:', JSON.stringify(trig));
    await wait(2500);

    const menu = await page.evaluate(() => {
        const out = [];
        for (const p of document.querySelectorAll('.cdk-overlay-pane, [role="menu"], [role="dialog"], .mat-mdc-menu-panel')) {
            const r = p.getBoundingClientRect();
            if (r.width < 40 || r.height < 20) continue;
            out.push({
                cls: String(p.className).slice(0, 70),
                text: (p.innerText || '').replace(/\n/g, ' | ').slice(0, 600),
                items: [...p.querySelectorAll('[role="menuitem"], mat-option, button, li, [role="radio"], [role="option"], .mdc-list-item')]
                    .map((el) => ({
                        tag: el.tagName.toLowerCase(),
                        role: el.getAttribute('role'),
                        checked: el.getAttribute('aria-checked') || el.getAttribute('aria-selected'),
                        text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 45),
                    })).filter(x => x.text),
            });
        }
        return out;
    });
    console.log('\n=== MENUS ===');
    console.log(JSON.stringify(menu, null, 1));
    await page.keyboard.press('Escape');
    await browser.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
