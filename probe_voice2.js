const puppeteer = require('D:/MyFinalAutomations/Veo3/node_modules/puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const page = (await b.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.log('no project tab'); process.exit(1); }
    await page.keyboard.press('Escape');
    await wait(700);

    const opened = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => !!x.querySelector('.add-menu-icon'))
            || document.querySelector('button[aria-label="Add ingredients to the prompt box"]');
        if (!b) return false; b.click(); return true;
    });
    console.log('opened add menu:', opened);
    await wait(2200);

    const clickedVoices = await page.evaluate(() => {
        const el = [...document.querySelectorAll('mat-list-item, [role="menuitem"], span')]
            .find(x => /^voices$/i.test((x.innerText || '').trim()));
        if (!el) return false; el.click(); return true;
    });
    console.log('clicked Voices:', clickedVoices);
    await wait(1500);

    const inp = await page.evaluate(() => {
        const i = document.querySelector('input[aria-label="Search assets"], input.search-input');
        if (!i) return null;
        i.focus();
        const r = i.getBoundingClientRect();
        return { cls: String(i.className).slice(0, 40), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    console.log('search input:', JSON.stringify(inp));
    if (inp) { await page.mouse.click(inp.x, inp.y); await wait(400); }
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('orus', { delay: 60 });
    await wait(2000);

    const out = await page.evaluate(() => ({
        searchVal: (document.querySelector('input[aria-label="Search assets"], input.search-input') || {}).value,
        items: [...document.querySelectorAll('button.asset-item')].map(x => (x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 45)),
        allText: (document.querySelector('.cdk-overlay-pane') || {}).innerText ? document.querySelector('.cdk-overlay-pane').innerText.replace(/\n/g, ' | ').slice(0, 400) : null,
    }));
    console.log('search value:', JSON.stringify(out.searchVal));
    console.log('asset items:', JSON.stringify(out.items, null, 1));
    console.log('pane text:', out.allText);

    await page.keyboard.press('Escape');
    await b.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
