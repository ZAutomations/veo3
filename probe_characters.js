// probe_characters.js - read-only: what does Flow's @ picker offer?
//
//   node probe_characters.js
//
// Opens the mention picker in the (empty) prompt box, dumps every result, then
// clicks the "Characters" category and dumps that too. The prompt box is
// cleared again before exit. Nothing is submitted; Generate is never clicked.

const puppeteer = require('puppeteer');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const CDP = 'http://127.0.0.1:9222';

const pickerFn = () => {
    const panes = [...document.querySelectorAll('.cdk-overlay-pane')];
    const out = { open: panes.length > 0, panes: panes.length, items: [], categories: [] };
    const desc = (el) => ({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 80),
        text: (el.innerText || el.textContent || '').trim().replace(/\n/g, ' | ').slice(0, 90),
        sel: el.getAttribute('aria-selected'),
    });
    for (const p of panes) {
        // left column = category tabs
        out.categories.push(...[...p.querySelectorAll('mat-list-item')].map(desc));
        // right column = the actual result rows
        for (const b of p.querySelectorAll('button.asset-item, [role="option"], mat-option')) {
            out.items.push(desc(b));
        }
        const vp = p.querySelector('cdk-virtual-scroll-viewport');
        if (vp) {
            out.viewport = true;
            out.rows = [...vp.querySelectorAll('button')].map(desc);
        }
    }
    return out;
};

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages.find(p => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow project tab open.'); process.exit(1); }

    const before = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                || document.querySelector('.ProseMirror');
        return pm ? (pm.innerText || '').length : -1;
    });
    console.log(`Prompt box holds ${before} characters before we start.`);
    if (before > 2) {
        console.error('Prompt box is NOT empty - refusing to touch it. Clear it and re-run.');
        await browser.disconnect();
        process.exit(1);
    }

    const box = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                || document.querySelector('.ProseMirror');
        if (!pm) return null;
        pm.scrollIntoView({ block: 'center' });
        const r = pm.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!box) { console.error('No prompt box.'); await browser.disconnect(); process.exit(1); }

    await page.mouse.click(box.x, box.y);
    await wait(600);

    console.log('\n=== typing "@" (no filter) ===');
    await page.keyboard.type('@', { delay: 140 });
    await wait(2500);
    let pk = await page.evaluate(pickerFn);
    console.log(`open=${pk.open} panes=${pk.panes} items=${pk.items.length} rows=${(pk.rows || []).length}`);
    console.log('categories:', pk.categories.map(c => c.text).filter((v, i, a) => a.indexOf(v) === i).join(' / '));
    console.log('result rows:');
    (pk.rows || pk.items).forEach(r => console.log(`   - [${r.cls.split(' ')[0]}] "${r.text}" sel=${r.sel}`));

    // Click the "Characters" category tab, if there is one.
    const clicked = await page.evaluate(() => {
        for (const p of document.querySelectorAll('.cdk-overlay-pane')) {
            for (const li of p.querySelectorAll('mat-list-item')) {
                if (/^\s*Characters\s*$/m.test(li.innerText || '')) { li.click(); return true; }
            }
        }
        return false;
    });
    if (clicked) {
        console.log('\n=== Characters tab ===');
        await wait(2500);
        pk = await page.evaluate(pickerFn);
        console.log(`open=${pk.open} items=${pk.items.length} rows=${(pk.rows || []).length}`);
        (pk.rows || pk.items).forEach(r => console.log(`   - [${r.cls.split(' ')[0]}] "${r.text}" sel=${r.sel}`));
        if (!(pk.rows || pk.items).length) console.log('   (EMPTY - no saved characters in this account)');
    } else {
        console.log('\n(no Characters category found in the pane)');
    }

    // Restore: close the picker and empty the box.
    await page.keyboard.press('Escape');
    await wait(600);
    await page.mouse.click(box.x, box.y);
    await wait(300);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Delete');
    await wait(600);

    const after = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                || document.querySelector('.ProseMirror');
        return pm ? (pm.innerText || '').trim().length : -1;
    });
    console.log(`\nPrompt box restored: ${after} characters (was ${before}).`);

    await browser.disconnect();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
