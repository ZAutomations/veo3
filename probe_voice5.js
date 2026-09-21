const puppeteer = require('D:/MyFinalAutomations/Veo3/node_modules/puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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

    for (const term of ['', 'or', 'o', 'a']) {
        const names = await page.evaluate((t) => {
            const inp = document.querySelector('input[aria-label="Search assets"]');
            if (inp) { inp.focus(); }
            return t;
        }, term);
        // clear + type
        await page.evaluate(() => { const i = document.querySelector('input[aria-label="Search assets"]'); if (i) i.focus(); });
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        if (term) await page.keyboard.type(term, { delay: 50 });
        await wait(1800);
        const items = await page.evaluate(() => [...document.querySelectorAll('button.asset-item')]
            .map(x => (x.innerText || '').replace(/\s+/g, ' ').replace(/voice_selection/i, '').trim()));
        console.log(`term "${term}": ${items.length} -> ${JSON.stringify(items.slice(0, 30))}`);
    }
    await page.keyboard.press('Escape');
    await b.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
