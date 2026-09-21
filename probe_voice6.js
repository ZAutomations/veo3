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

    const names = new Set();
    for (let i = 0; i < 20; i++) {
        const got = await page.evaluate(() => {
            // scroll whatever holds the asset items
            const anyItem = document.querySelector('button.asset-item');
            let sc = anyItem ? anyItem.parentElement : null;
            for (let k = 0; k < 6 && sc; k++) {
                if (sc.scrollHeight > sc.clientHeight + 10) break;
                sc = sc.parentElement;
            }
            if (sc) sc.scrollTop += 400;
            return [...document.querySelectorAll('button.asset-item')].map(x => (x.innerText || '').replace(/\s+/g, ' ').replace(/voice_selection/i, '').trim());
        });
        got.forEach(n => names.add(n));
        await wait(500);
    }
    console.log('TOTAL unique voices seen:', names.size);
    console.log([...names].sort().join('\n'));
    await page.keyboard.press('Escape');
    await b.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
