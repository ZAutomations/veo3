const puppeteer = require('D:/MyFinalAutomations/Veo3/node_modules/puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dump = (page, tag) => page.evaluate((t) => ({
    tag: t,
    panes: [...document.querySelectorAll('.cdk-overlay-pane')].filter(p => { const r = p.getBoundingClientRect(); return r.width > 40 && r.height > 20; }).length,
    assetItems: document.querySelectorAll('button.asset-item').length,
    activeItems: document.querySelectorAll('button.asset-item-active').length,
    addToPromptByClass: !!document.querySelector('[class*=detail-add-to]'),
    addToPromptClasses: [...document.querySelectorAll('[class*=detail-add-to]')].map(x => x.tagName.toLowerCase() + '.' + String(x.className).slice(0, 60)),
    buttonsWithAdd: [...document.querySelectorAll('button')].filter(b => /add/i.test((b.innerText || ''))).map(b => ({ cls: String(b.className).slice(0, 55), text: (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30) })),
    paneText: (document.querySelector('.cdk-overlay-pane') || {}).innerText ? document.querySelector('.cdk-overlay-pane').innerText.replace(/\n/g, ' | ').slice(0, 220) : null,
}), tag).then(s => console.log(JSON.stringify(s, null, 1)));

(async () => {
    const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const page = (await b.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.log('no project tab'); process.exit(1); }
    await page.keyboard.press('Escape');
    await wait(800);
    await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => !!x.querySelector('.add-menu-icon'))
            || document.querySelector('button[aria-label="Add ingredients to the prompt box"]');
        if (b) b.click();
    });
    await wait(2500);
    const pt = await page.evaluate(() => { const i = document.querySelector('input[aria-label="Search assets"]'); if (!i) return null; const r = i.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
    if (pt) { await page.mouse.click(pt.x, pt.y); await wait(300); await page.keyboard.type('Alnilam', { delay: 50 }); }
    await wait(2000);
    await dump(page, 'after search');

    const clicked = await page.evaluate(() => {
        const el = [...document.querySelectorAll('button.asset-item')].find(x => /alnilam/i.test(x.innerText || ''));
        if (!el) return false; el.click(); return true;
    });
    console.log('clicked item:', clicked);
    await wait(2500);
    await dump(page, 'after item click');

    await page.keyboard.press('Escape');
    await b.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
