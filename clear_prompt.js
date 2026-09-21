// clear_prompt.js - empty Flow's Agent Mode prompt box.
//
//   node clear_prompt.js
//
// Useful after a --no-submit run, which deliberately leaves the prompt and its
// mention chips in the box. Clears the box only; touches nothing else.

const puppeteer = require('puppeteer');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const pages = await browser.pages();
    const page = pages.find(p => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow project tab open.'); process.exit(1); }
    console.log('Flow tab:', page.url());

    const box = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                || document.querySelector('.ProseMirror');
        if (!pm) return null;
        pm.scrollIntoView({ block: 'center' });
        const r = pm.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
                 len: (pm.innerText || '').trim().length,
                 chips: pm.querySelectorAll('.mention-chip').length };
    });
    if (!box) { console.error('Prompt box not found.'); process.exit(1); }
    console.log(`Before: ${box.len} chars, ${box.chips} mention chip(s).`);
    if (!box.len && !box.chips) { console.log('Already empty.'); await browser.disconnect(); return; }

    // Ctrl+A is unreliable here: the ProseMirror editor does not always hold
    // focus after a mouse click, and a page-level select-all misses the editor.
    // Drive the editor's own command path instead - the same one the paste step
    // uses to replace the box contents.
    const cleared = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                || document.querySelector('.ProseMirror');
        if (!pm) return 'no-editor';
        pm.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(pm);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
        // Some builds keep the mention chips as separate widget nodes that the
        // text delete walks past; drop them directly if any survive.
        for (const chip of pm.querySelectorAll('.mention-chip')) chip.remove();
        pm.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return (pm.innerText || '').trim().length;
    });
    console.log('Editor reports after clear:', cleared, 'characters.');
    await wait(700);

    const after = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                || document.querySelector('.ProseMirror');
        return { len: (pm.innerText || '').trim().length, chips: pm.querySelectorAll('.mention-chip').length };
    });
    console.log(`After : ${after.len} chars, ${after.chips} mention chip(s).`);
    console.log((after.len === 0 && after.chips === 0) ? 'Box is empty.' : 'Box still has content - clear it by hand.');

    await browser.disconnect();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
