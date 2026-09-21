const puppeteer = require('D:/MyFinalAutomations/Veo3/node_modules/puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (page, tag) => page.evaluate((t) => ({
    tag: t,
    panes: [...document.querySelectorAll('.cdk-overlay-pane')].filter(p => { const r = p.getBoundingClientRect(); return r.width > 40 && r.height > 20; }).length,
    assetItems: document.querySelectorAll('button.asset-item').length,
    searchInput: !!document.querySelector('input[aria-label="Search assets"]'),
    searchVal: (document.querySelector('input[aria-label="Search assets"]') || {}).value,
    addToPrompt: !!document.querySelector('[class*=detail-add-to]'),
    voicesNav: [...document.querySelectorAll('span,mat-list-item')].some(x => /^voices$/i.test((x.innerText || '').trim())),
    paneText: (document.querySelector('.cdk-overlay-pane') || {}).innerText ? document.querySelector('.cdk-overlay-pane').innerText.replace(/\n/g, ' | ').slice(0, 220) : null,
}), tag).then(s => console.log(JSON.stringify(s)));

(async () => {
    const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const page = (await b.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.log('no project tab'); process.exit(1); }
    await page.keyboard.press('Escape');
    await wait(800);

    const opened = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => !!x.querySelector('.add-menu-icon'))
            || document.querySelector('button[aria-label="Add ingredients to the prompt box"]');
        if (!b) return false; b.click(); return true;
    });
    console.log('opened:', opened);
    await wait(2500);
    await state(page, 'after-open');

    await page.evaluate(() => {
        const el = [...document.querySelectorAll('mat-list-item, [role="menuitem"], span')]
            .find(x => /^voices$/i.test((x.innerText || '').trim()));
        if (el) el.click();
    });
    await wait(1500);
    await state(page, 'after-Voices-click');

    const pt = await page.evaluate(() => {
        const i = document.querySelector('input[aria-label="Search assets"]');
        if (!i) return null;
        const r = i.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) };
    });
    console.log('search box:', JSON.stringify(pt));
    if (pt) { await page.mouse.click(pt.x, pt.y); await wait(400); await page.keyboard.type('orus', { delay: 60 }); }
    await wait(2000);
    await state(page, 'after-typing');

    await page.keyboard.press('Escape');
    await b.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
