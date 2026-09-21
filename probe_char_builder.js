// probe_char_builder.js - read-only: find Flow's Character Builder and see what
// saved characters actually exist on this account.
//
//   node probe_char_builder.js
//
// The claim under test: the user switched from attaching raw character images in
// the agent prompt to building named Characters in Flow's Character Builder, and
// that switch is what broke consistency.
//
// Reads and reports only. Opens menus (non-destructive) and restores the prompt
// box afterwards. Clicks no Generate, uploads nothing, deletes nothing.

const puppeteer = require('puppeteer');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const CDP = 'http://127.0.0.1:9222';

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    const pages = await browser.pages();
    const flow = pages.filter(p => /flow\.google\.com/.test(p.url() || ''));
    console.log('Flow tabs:');
    flow.forEach(p => console.log('   ' + p.url()));

    const page = flow.find(p => /\/project\//.test(p.url()));
    if (!page) { console.error('\nNo Flow project tab open.'); process.exit(1); }
    console.log('\nUsing:', page.url());

    // ------------------------------------------------------------------
    // 1. Every entry point that could be the Character Builder or the asset
    //    library that holds characters.
    // ------------------------------------------------------------------
    const nav = await page.evaluate(() => {
        const desc = (el) => ({
            tag: el.tagName.toLowerCase(),
            aria: el.getAttribute('aria-label'),
            text: (el.innerText || el.textContent || '').trim().replace(/\n/g, ' | ').slice(0, 70),
            cls: (el.className || '').toString().slice(0, 55),
            vis: (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
        });
        const kw = /character|asset|library|ingredient|avatar|saved|collection/i;
        return {
            hits: [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"], mat-list-item, [aria-label]')]
                .filter(el => kw.test((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '')))
                .map(desc)
                .filter((v, i, a) => a.findIndex(x => x.text === v.text && x.aria === v.aria) === i)
                .slice(0, 30),
            sidebar: [...document.querySelectorAll('mat-list-item, nav a, [class*="side-nav"] [role="button"]')]
                .map(desc).filter(e => e.vis && e.text).slice(0, 25),
        };
    });
    console.log('\n=== entries mentioning character / asset / library ===');
    nav.hits.forEach(h => console.log(`   [${h.tag}] vis=${h.vis} aria="${h.aria}" "${h.text}"`));
    if (!nav.hits.length) console.log('   (none)');
    console.log('\n=== sidebar ===');
    nav.sidebar.forEach(s => console.log(`   "${s.text}"`));
    if (!nav.sidebar.length) console.log('   (none)');

    // ------------------------------------------------------------------
    // 2. The @ picker: full category list, and what the Characters tab holds.
    //    This is the surface agent_mode.js actually drives.
    // ------------------------------------------------------------------
    const box = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                || document.querySelector('.ProseMirror');
        if (!pm) return null;
        pm.scrollIntoView({ block: 'center' });
        const r = pm.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
                 text: (pm.innerText || '').trim() };
    });
    if (!box) { console.log('\n(no prompt box found - skipping picker probe)'); await browser.disconnect(); return; }

    const original = box.text;
    if (original) {
        // Someone has a draft in the box. Do not touch it - probing would mean
        // typing '@' into their text and then trying to undo it.
        console.log(`\nPrompt box already holds ${original.length} chars of a draft: ${JSON.stringify(original.slice(0, 80))}`);
        console.log('Refusing to type into it. Clear the box (or open a fresh project) and re-run.');
        await browser.disconnect();
        return;
    }
    console.log('\nPrompt box is empty - safe to probe and restore.');

    await page.mouse.click(box.x, box.y);
    await wait(400);
    await page.keyboard.type('@', { delay: 130 });
    await wait(2600);

    const cats = await page.evaluate(() => {
        const out = { categories: [], tiles: [] };
        for (const p of document.querySelectorAll('.cdk-overlay-pane')) {
            const r = p.getBoundingClientRect();
            if (r.width < 40 || r.height < 20) continue;
            out.categories.push(...[...p.querySelectorAll('mat-list-item, [role="tab"], [role="option"]')]
                .map(el => (el.innerText || '').trim().replace(/\n/g, ' ').slice(0, 40)).filter(Boolean));
            out.tiles.push(...[...p.querySelectorAll('[class*="asset" i], [class*="tile" i], [class*="result" i]')]
                .map(el => (el.innerText || '').trim().replace(/\n/g, ' ').slice(0, 60)).filter(Boolean));
        }
        return { categories: [...new Set(out.categories)], tiles: [...new Set(out.tiles)].slice(0, 30) };
    });
    console.log('\n=== @ picker categories ===');
    console.log('   ' + (cats.categories.join('  |  ') || '(none)'));
    console.log('=== @ picker tiles (the "All" tab) ===');
    cats.tiles.forEach(t => console.log(`   "${t}"`));

    // Now click into the Characters category specifically.
    const charPane = await page.evaluate(async () => {
        let clicked = false;
        for (const p of document.querySelectorAll('.cdk-overlay-pane')) {
            for (const li of p.querySelectorAll('mat-list-item, [role="tab"], [role="option"]')) {
                if (/^\s*Characters\s*$/i.test((li.innerText || '').trim())) { li.click(); clicked = true; break; }
            }
            if (clicked) break;
        }
        return clicked;
    });
    console.log('\nclicked Characters category:', charPane);
    await wait(2000);

    const pane = await page.evaluate(() => {
        const out = [];
        for (const p of document.querySelectorAll('.cdk-overlay-pane')) {
            const r = p.getBoundingClientRect();
            if (r.width < 40 || r.height < 20) continue;
            out.push({
                text: (p.innerText || '').trim().replace(/\n/g, ' | ').slice(0, 500),
                buttons: [...p.querySelectorAll('button')]
                    .map(b => ((b.innerText || '').trim() || b.getAttribute('aria-label') || '').slice(0, 45))
                    .filter(Boolean),
                hasFileInput: !!p.querySelector('input[type="file"]'),
            });
        }
        return out;
    });
    console.log('=== Characters tab content ===');
    pane.forEach(p => {
        console.log('   text  :', JSON.stringify(p.text));
        console.log('   btns  :', p.buttons.join(' , ') || '(none)');
        console.log('   upload:', p.hasFileInput ? 'YES - this tab can take an upload' : 'no file input');
    });
    if (!pane.length) console.log('   (pane did not render)');

    // ------------------------------------------------------------------
    // 3. Close the picker and clean the prompt box back to its prior state.
    // ------------------------------------------------------------------
    await page.keyboard.press('Escape');
    await wait(500);
    await page.mouse.click(box.x, box.y);
    await wait(300);
    const before = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror') || document.querySelector('.ProseMirror');
        return pm ? (pm.innerText || '').trim().length : -1;
    });
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Delete');
    await wait(400);
    console.log(`\nPrompt box: was ${before} chars, cleared back to empty (restores the pre-probe state).`);

    await browser.disconnect();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
