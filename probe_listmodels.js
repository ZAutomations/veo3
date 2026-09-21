const puppeteer = require('puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const page = (await browser.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow project tab open.'); process.exit(1); }
    console.log('page:', page.url());
    await page.keyboard.press('Escape');
    await wait(800);

    const trig = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /settings trigger/i.test(x.getAttribute('aria-label') || ''));
        if (b) { b.click(); return { ok: true, text: (b.innerText || '').trim().slice(0, 40) }; }
        // fallback: any element with the summary
        const s = document.querySelector('.settings-summary, [settingstriggercontent]');
        return { ok: false, summary: s ? (s.innerText || '').trim().slice(0, 60) : null };
    });
    console.log('trigger:', JSON.stringify(trig));
    await wait(1800);

    const panes = await page.evaluate(() => {
        const out = [];
        for (const p of document.querySelectorAll('.cdk-overlay-pane, .mat-mdc-menu-panel')) {
            const r = p.getBoundingClientRect();
            if (r.width < 40 || r.height < 20) continue;
            out.push({
                cls: String(p.className).slice(0, 60),
                text: (p.innerText || '').replace(/\n/g, ' | ').slice(0, 200),
                nbuttons: p.querySelectorAll('button').length,
            });
        }
        return out;
    });
    console.log('panes after trigger:', JSON.stringify(panes, null, 1));

    const row = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.cdk-overlay-pane button, .mat-mdc-menu-panel button')];
        const b = btns.find(x => /Veo|Omni|Nano|Imagen|Banana/i.test((x.innerText || '').trim()));
        if (b) { b.click(); return { ok: true, text: (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50) }; }
        return { ok: false, sample: btns.map(x => (x.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 25)).slice(0, 15) };
    });
    console.log('model row:', JSON.stringify(row));
    await wait(1500);

    const models = await page.evaluate(() => {
        const panel = document.querySelector('.flow-model-picker-panel')
            || [...document.querySelectorAll('.cdk-overlay-pane')].find(p => /Veo|Omni|Nano|Imagen|Banana/i.test(p.innerText || ''));
        if (!panel) return { found: false, panes: [...document.querySelectorAll('.cdk-overlay-pane')].map(p => (p.innerText || '').replace(/\n/g, ' | ').slice(0, 120)) };
        return { found: true, cls: String(panel.className).slice(0, 50), items: [...panel.querySelectorAll('[role="menuitem"]')].map(el => (el.innerText || '').replace(/volume_up/gi, '').trim()) };
    });
    console.log('models:', JSON.stringify(models, null, 1));

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await browser.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
