const puppeteer = require('D:/MyFinalAutomations/Veo3/node_modules/puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (page, tag) => page.evaluate((t) => ({
    tag: t,
    panes: [...document.querySelectorAll('.cdk-overlay-pane')].filter(p => { const r = p.getBoundingClientRect(); return r.width > 40 && r.height > 20; }).length,
    assetItems: document.querySelectorAll('button.asset-item').length,
    searchInput: !!document.querySelector('input[aria-label="Search assets"]'),
    paneText: (document.querySelector('.cdk-overlay-pane') || {}).innerText ? document.querySelector('.cdk-overlay-pane').innerText.replace(/\n/g, ' | ').slice(0, 200) : null,
}), tag).then(s => console.log(JSON.stringify(s)));

(async () => {
    const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const page = (await b.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.log('no project tab'); process.exit(1); }
    await page.keyboard.press('Escape');
    await wait(800);

    // Mimic agent_mode: focus the prompt and type, THEN open the add menu.
    const box = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror') || document.querySelector('.ProseMirror');
        if (!pm) return null; const r = pm.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (box) { await page.mouse.click(box.x, box.y); await wait(500); await page.keyboard.type('test only', { delay: 40 }); }
    await wait(800);
    console.log('typed prompt');

    const opened = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => !!x.querySelector('.add-menu-icon'))
            || document.querySelector('button[aria-label="Add ingredients to the prompt box"]');
        if (!b) return false; b.click(); return true;
    });
    console.log('opened add menu:', opened);
    await wait(2500);
    await st(page, 'after open (with prompt text)');

    await page.evaluate(() => {
        const el = [...document.querySelectorAll('mat-list-item, [role="menuitem"], span')].find(x => /^voices$/i.test((x.innerText || '').trim()));
        if (el) el.click();
    });
    await wait(1500);
    await st(page, 'after Voices click');

    await page.keyboard.press('Escape');
    await b.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
