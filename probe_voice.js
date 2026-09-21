const puppeteer = require('D:/MyFinalAutomations/Veo3/node_modules/puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function dump(page, tag) {
    const out = await page.evaluate(() => {
        const panes = [];
        for (const p of document.querySelectorAll('.cdk-overlay-pane, [role="menu"], [role="dialog"], .mat-mdc-menu-panel, .cdk-overlay-container')) {
            const r = p.getBoundingClientRect();
            if (r.width < 40 || r.height < 20) continue;
            panes.push({
                cls: String(p.className).slice(0, 60),
                text: (p.innerText || '').replace(/\n/g, ' | ').slice(0, 350),
                items: [...p.querySelectorAll('[role="menuitem"], mat-list-item, button, li, .side-nav-list-item-title, input')]
                    .map((el) => ({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 45), aria: el.getAttribute('aria-label'), ph: el.getAttribute('placeholder'), text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40) }))
                    .filter((x) => x.text || x.aria || x.ph),
            });
        }
        return panes;
    });
    console.log('--- ' + tag + ' (' + out.length + ') ---');
    console.log(JSON.stringify(out, null, 1));
}
(async () => {
    const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const page = (await b.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.log('no project tab'); process.exit(1); }
    console.log('page:', page.url());
    await page.keyboard.press('Escape');
    await wait(700);

    const addBtns = await page.evaluate(() => [...document.querySelectorAll('button')]
        .filter(b => /add/i.test(b.getAttribute('aria-label') || '') || !!b.querySelector('.add-menu-icon'))
        .map(b => ({ aria: b.getAttribute('aria-label'), cls: String(b.className).slice(0, 50), hasIcon: !!b.querySelector('.add-menu-icon'), vis: b.getBoundingClientRect().width > 0 })));
    console.log('ADD BUTTONS:', JSON.stringify(addBtns, null, 1));

    const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => !!x.querySelector('.add-menu-icon') && x.getBoundingClientRect().width > 0)
            || [...document.querySelectorAll('button')].find(x => /add media menu/i.test(x.getAttribute('aria-label') || ''));
        if (!b) return false;
        b.click();
        return b.getAttribute('aria-label') || 'add-menu-icon';
    });
    console.log('clicked add:', clicked);
    await wait(2500);
    await dump(page, 'after add');

    const voices = await page.evaluate(() => {
        const el = [...document.querySelectorAll('[role="menuitem"], mat-list-item, button, li, .side-nav-list-item-title, span')]
            .find(x => /^voices$/i.test((x.innerText || '').trim()));
        if (!el) return false;
        el.click();
        return true;
    });
    console.log('clicked Voices:', voices);
    await wait(2500);
    await dump(page, 'after Voices');

    await page.keyboard.press('Escape');
    await b.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
