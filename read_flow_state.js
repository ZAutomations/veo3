// read_flow_state.js - read-only look at the open Flow tab.
//
//   node read_flow_state.js
//
// Answers one question: what does the @ mention picker actually offer for
// "Tara" - a saved Character, or just the uploaded JPG? It never clicks
// Generate and never submits anything.

const puppeteer = require('puppeteer');

const CDP = 'http://127.0.0.1:9222';

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages.find(p => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow project tab open.'); process.exit(1); }
    console.log('Flow tab:', page.url());

    const state = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                || document.querySelector('.ProseMirror');
        return {
            promptBoxFound: !!pm,
            promptBoxText: pm ? (pm.innerText || '').slice(0, 300) : null,
            promptBoxLength: pm ? (pm.innerText || '').length : 0,
            agentToggle: !!document.querySelector('flow-agent-mode-toggle-chip'),
            agentOn: (() => {
                const c = document.querySelector('flow-agent-mode-toggle-chip');
                return c ? /checked/.test((c.className || '').toString()) : null;
            })(),
            generateBtn: (() => {
                const b = document.querySelector('button[aria-label="Start generation"]');
                if (!b) return 'not found';
                return (b.disabled || /disabled/.test((b.className || '').toString())) ? 'disabled' : 'ready';
            })(),
            // Anything on the page that names a saved character.
            characterish: [...document.querySelectorAll('[class*="character" i], [aria-label*="character" i]')]
                .slice(0, 20)
                .map(el => ({
                    tag: el.tagName.toLowerCase(),
                    cls: (el.className || '').toString().slice(0, 90),
                    aria: el.getAttribute('aria-label'),
                    text: (el.innerText || '').trim().slice(0, 90),
                })),
        };
    });

    console.log(JSON.stringify(state, null, 2));
    await browser.disconnect();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
