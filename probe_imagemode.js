const puppeteer = require('puppeteer');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function paneOpen(page) {
    return await page.evaluate(() => !!([...document.querySelectorAll('.cdk-overlay-pane')].find(p => /Image|Video|Veo|Omni|Nano/i.test(p.innerText || ''))));
}
async function openMenu(page) {
    for (let i = 0; i < 4; i++) {
        const box = await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')].find(x => /settings trigger/i.test(x.getAttribute('aria-label') || ''));
            const el = b || document.querySelector('[settingstriggercontent]');
            if (!el) return null;
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        });
        if (!box) return false;
        await page.mouse.click(box.x, box.y);
        await wait(3000);
        if (await paneOpen(page)) return true;
        await page.keyboard.press('Escape');
        await wait(600);
    }
    return false;
}
const modeState = (page) => page.evaluate(() => {
    const p = [...document.querySelectorAll('.cdk-overlay-pane')].find(p => /Image|Video/i.test(p.innerText || ''));
    if (!p) return { pane: false };
    const radios = [...p.querySelectorAll('[role="radio"]')].map(el => ({ checked: el.getAttribute('aria-checked'), text: (el.innerText || '').trim().replace(/\s+/g, ' ') }));
    const img = radios.find(r => /image/i.test(r.text) && !/video/i.test(r.text));
    const vid = radios.find(r => /video/i.test(r.text) && !/image/i.test(r.text));
    const modelRow = [...p.querySelectorAll('button')].map(b => (b.innerText || '').replace(/\s+/g, ' ').trim()).find(t => /Veo|Omni|Nano|Imagen|Banana/i.test(t));
    return { image: img ? img.checked : null, video: vid ? vid.checked : null, modelRow };
});
(async () => {
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const page = (await browser.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('no project tab'); process.exit(1); }
    console.log('page:', page.url());
    await page.keyboard.press('Escape');
    await wait(700);

    if (!await openMenu(page)) { console.log('could not open menu'); process.exit(1); }
    console.log('BEFORE:', JSON.stringify(await modeState(page)));

    const clicked = await page.evaluate(() => {
        const p = [...document.querySelectorAll('.cdk-overlay-pane')].find(p => /Image|Video/i.test(p.innerText || ''));
        const r = [...p.querySelectorAll('[role="radio"]')].find(el => /image/i.test((el.innerText || '')) && !/video/i.test((el.innerText || '')));
        if (!r) return false;
        r.click();
        return true;
    });
    console.log('clicked Image radio:', clicked);
    await wait(3500);
    console.log('AFTER :', JSON.stringify(await modeState(page)));

    await page.keyboard.press('Escape');
    await browser.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
