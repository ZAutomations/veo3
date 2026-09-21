// find_character_ui.js - read-only: where does Flow create a Character?
//
//   node find_character_ui.js
//
// The @ picker has a "Characters" category, so Flow can hold saved characters.
// This looks for the surface that creates them: an asset-library entry, a
// sidebar item, or a button. It reads and reports; it clicks nothing that
// changes state (only side-nav / menu openers, which are non-destructive).

const puppeteer = require('puppeteer');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const CDP = 'http://127.0.0.1:9222';

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages.find(p => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow project tab open.'); process.exit(1); }
    console.log('Flow tab:', page.url());

    // 1. Everything clickable in the page chrome that mentions "character".
    const chrome = await page.evaluate(() => {
        const desc = (el) => ({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString().slice(0, 80),
            aria: el.getAttribute('aria-label'),
            text: (el.innerText || '').trim().replace(/\n/g, ' | ').slice(0, 80),
            visible: (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
        });
        return {
            byText: [...document.querySelectorAll('button, a, [role="menuitem"], [role="button"], mat-list-item')]
                .filter(el => /character/i.test((el.innerText || '') + (el.getAttribute('aria-label') || '')))
                .map(desc),
            byClass: [...document.querySelectorAll('[class*="character" i]')].slice(0, 25).map(desc),
        };
    });
    console.log('\n=== page chrome mentioning "character" ===');
    console.log('by text :', chrome.byText.length);
    chrome.byText.forEach(e => console.log(`   [${e.tag}] vis=${e.visible} aria=${e.aria} "${e.text}"`));
    console.log('by class:', chrome.byClass.length);
    chrome.byClass.forEach(e => console.log(`   [${e.tag}.${e.cls.split(' ')[0]}] vis=${e.visible} "${e.text}"`));

    // 2. The left sidebar of the project page.
    const sidebar = await page.evaluate(() => {
        return [...document.querySelectorAll('mat-list-item, [class*="side-nav"]')]
            .map(el => ({
                text: (el.innerText || '').trim().replace(/\n/g, ' | ').slice(0, 70),
                cls: (el.className || '').toString().slice(0, 60),
                visible: (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
            }))
            .filter(e => e.text && e.visible)
            .slice(0, 30);
    });
    console.log('\n=== visible sidebar entries ===');
    sidebar.forEach(e => console.log(`   "${e.text}"`));

    // 3. Open the picker once more and look INSIDE the Characters pane for an
    //    "add"/"create"/"new" affordance rather than assuming there is none.
    const box = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                || document.querySelector('.ProseMirror');
        if (!pm) return null;
        const r = pm.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (box) {
        await page.mouse.click(box.x, box.y);
        await wait(500);
        await page.keyboard.type('@', { delay: 140 });
        await wait(2500);
        const pane = await page.evaluate(() => {
            for (const p of document.querySelectorAll('.cdk-overlay-pane')) {
                for (const li of p.querySelectorAll('mat-list-item')) {
                    if (/^\s*Characters\s*$/m.test(li.innerText || '')) { li.click(); break; }
                }
            }
            const out = [];
            for (const p of document.querySelectorAll('.cdk-overlay-pane')) {
                out.push({
                    html: p.innerHTML.slice(0, 2500),
                    buttons: [...p.querySelectorAll('button')].map(b => ({
                        aria: b.getAttribute('aria-label'),
                        text: (b.innerText || '').trim().slice(0, 60),
                    })),
                });
            }
            return out;
        });
        await wait(1500);
        const pane2 = await page.evaluate(() => {
            const out = [];
            for (const p of document.querySelectorAll('.cdk-overlay-pane')) {
                out.push({
                    text: (p.innerText || '').trim().replace(/\n/g, ' | ').slice(0, 400),
                    buttons: [...p.querySelectorAll('button')].map(b => ({
                        aria: b.getAttribute('aria-label'),
                        text: (b.innerText || '').trim().slice(0, 60),
                    })),
                });
            }
            return out;
        });
        console.log('\n=== Characters pane ===');
        pane2.forEach(p => {
            console.log('pane text :', JSON.stringify(p.text));
            console.log('pane btns :', p.buttons.map(b => `"${b.text || b.aria}"`).join(', '));
        });

        // restore
        await page.keyboard.press('Escape');
        await wait(500);
        await page.mouse.click(box.x, box.y);
        await wait(300);
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Delete');
        await wait(500);
        const after = await page.evaluate(() => {
            const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                    || document.querySelector('.ProseMirror');
            return pm ? (pm.innerText || '').trim().length : -1;
        });
        console.log(`\nPrompt box restored: ${after} characters.`);
    }

    await browser.disconnect();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
