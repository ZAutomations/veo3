const puppeteer = require('puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function dump(page, tag) {
    const out = await page.evaluate(() => {
        const panes = [];
        for (const p of document.querySelectorAll('.cdk-overlay-pane, [role="menu"], [role="listbox"], .mat-mdc-menu-panel')) {
            const r = p.getBoundingClientRect();
            if (r.width < 40 || r.height < 20) continue;
            panes.push({
                cls: String(p.className).slice(0, 60),
                text: (p.innerText || '').replace(/\n/g, ' | ').slice(0, 400),
                items: [...p.querySelectorAll('button, [role="menuitem"], [role="option"], [role="radio"], mat-option, li')]
                    .map((el) => ({ role: el.getAttribute('role'), checked: el.getAttribute('aria-checked') || el.getAttribute('aria-selected'), text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 45) }))
                    .filter(x => x.text),
            });
        }
        return panes;
    });
    console.log('--- ' + tag + ' ---');
    console.log(JSON.stringify(out, null, 1));
}

(async () => {
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const page = (await browser.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow project tab open.'); process.exit(1); }
    await page.keyboard.press('Escape');
    await wait(800);

    console.log('trigger click:', await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /settings trigger/i.test(x.getAttribute('aria-label') || ''));
        if (!b) return false;
        b.click();
        return true;
    }));
    await wait(2500);
    await dump(page, 'after settings trigger');

    const dd = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.cdk-overlay-pane button, [role="menu"] button, .mat-mdc-menu-panel button, [role="dialog"] button')];
        const row = btns.find(b => /Veo|Nano|Imagen|Banana|Gemini/i.test((b.innerText || '').trim()));
        if (!row) return { ok: false, sample: btns.map(b => (b.innerText || '').trim().slice(0, 30)).slice(0, 20) };
        row.click();
        return { ok: true, text: (row.innerText || '').trim().slice(0, 50) };
    });
    console.log('model row click:', JSON.stringify(dd));
    await wait(2500);
    await dump(page, 'after model row');

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await browser.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
