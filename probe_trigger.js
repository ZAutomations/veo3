const puppeteer = require('puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const page = (await browser.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('no project tab'); process.exit(1); }
    console.log('page:', page.url());
    await page.keyboard.press('Escape');
    await wait(800);

    const box = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /settings trigger/i.test(x.getAttribute('aria-label') || ''));
        const el = b || document.querySelector('[settingstriggercontent]');
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) };
    });
    console.log('trigger box:', JSON.stringify(box));
    if (!box) process.exit(1);

    await page.mouse.click(box.x, box.y);
    await wait(3000);

    const panes = await page.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane, .mat-mdc-menu-panel')]
        .filter(p => { const r = p.getBoundingClientRect(); return r.width > 40 && r.height > 20; })
        .map(p => ({ cls: String(p.className).slice(0, 55), text: (p.innerText || '').replace(/\n/g, ' | ').slice(0, 220) })));
    console.log('panes after REAL click:', JSON.stringify(panes, null, 1));

    await page.keyboard.press('Escape');
    await browser.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
