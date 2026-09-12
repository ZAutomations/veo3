#!/usr/bin/env node
/**
 * AGENT INSTRUCTIONS PANEL PROBE
 * ===============================
 * Agent Instructions is where the ART STYLE rule has to live - it is project-wide,
 * so it applies to the agent's planning and not just one scene. To automate it we
 * need the panel's DOM: the guideline text box, the reference-image slot, the
 * "Add instruction" button and the Done button.
 *
 * The button is already known: button[aria-label="Agent instructions"] (the
 * article_spark icon, inside .agent-footer-actions). What we have never seen is
 * what it OPENS.
 *
 * HOW TO RUN:
 *   1. In the automation browser, open the Flow project.
 *   2. Click the spark icon in the prompt box to OPEN the Agent Instructions panel.
 *      (Leave it open - do not click Done.)
 *   3. Run:  node probe_instructions.js --cdp 9222
 *
 * Read-only: inspects and writes JSON. Never clicks, types, or saves anything.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const cdpIdx = process.argv.indexOf('--cdp');
const CDP = cdpIdx > -1
    ? `http://127.0.0.1:${process.argv[cdpIdx + 1]}`
    : 'http://127.0.0.1:9222';

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages.find(p => /flow\.google\.com/i.test(p.url() || ''));
    if (!page) {
        console.error('No Flow tab found. Open a Flow project first.');
        console.error('Open tabs:\n  ' + pages.map(p => p.url()).join('\n  '));
        process.exit(1);
    }
    console.log('Flow tab:', page.url());

    const report = await page.evaluate(() => {
        const cls = (el) => (el.className && el.className.toString) ? el.className.toString() : '';
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const d = (el, depth) => {
            const r = el.getBoundingClientRect();
            const o = {
                tag: el.tagName.toLowerCase(),
                cls: cls(el).slice(0, 170),
                aria: el.getAttribute('aria-label'),
                role: el.getAttribute('role'),
                ph: el.getAttribute('placeholder') || el.getAttribute('data-placeholder'),
                text: (el.innerText || el.textContent || '').trim().slice(0, 160),
                visible: r.width > 0 && r.height > 0,
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            };
            if (depth) o.children = [...el.children].slice(0, 25).map(c => d(c, depth - 1));
            return o;
        };

        // 1. Overlay panes: the panel almost certainly renders in one.
        const panes = [...document.querySelectorAll('.cdk-overlay-pane')]
            .filter(vis)
            .map(el => d(el, 4));

        // 2. Anything editable - that is where the guideline text goes.
        const editable = [...document.querySelectorAll(
            'textarea, input[type="text"], [contenteditable="true"], .ProseMirror, flow-rich-text-editor')]
            .filter(vis)
            .map(el => ({
                tag: el.tagName.toLowerCase(),
                cls: cls(el).slice(0, 140),
                aria: el.getAttribute('aria-label'),
                ph: el.getAttribute('placeholder'),
                text: (el.innerText || el.value || '').trim().slice(0, 200),
                rect: (() => { const r = el.getBoundingClientRect(); return {
                    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
            }));

        // 3. Everything instruction-shaped.
        const kw = /instruction|guideline|agent|reference|upload|style|image|slot|chip/i;
        const shaped = [...document.querySelectorAll('*')]
            .filter(el => kw.test(cls(el)))
            .filter(vis)
            .slice(0, 60)
            .map(el => d(el, 1));

        // 4. All visible buttons - we need Add instruction and Done.
        const buttons = [...document.querySelectorAll('button')]
            .filter(vis)
            .map(b => ({
                aria: b.getAttribute('aria-label'),
                text: (b.innerText || '').trim().slice(0, 60),
                cls: cls(b).slice(0, 140),
                disabled: b.disabled || /mat-mdc-button-disabled/.test(cls(b)),
                rect: (() => { const r = b.getBoundingClientRect(); return {
                    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
            }))
            .filter(b => b.aria || b.text);

        // 5. File inputs - the reference image may be uploaded through a hidden one.
        const fileInputs = [...document.querySelectorAll('input[type="file"]')]
            .map(el => ({ accept: el.accept, multiple: el.multiple, cls: cls(el).slice(0, 120) }));

        return {
            url: location.href,
            panelsOpen: panes.length,
            panes,
            editable,
            shaped,
            buttons,
            fileInputs,
            tail: (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(-1500),
        };
    });

    const outDir = path.join(__dirname, 'logs');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `instructions_probe_${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));

    console.log('');
    console.log('panels open   :', report.panelsOpen, report.panelsOpen ? '' : '<-- panel probably NOT open');
    console.log('editable boxes:', report.editable.length);
    for (const e of report.editable) {
        console.log(`   ${e.tag} [${(e.cls || '').split(' ')[0]}] ph="${e.ph || ''}" "${(e.text || '').slice(0, 60)}"`);
    }
    console.log('instruction-ish:', report.shaped.length);
    console.log('visible buttons:', report.buttons.length);
    for (const b of report.buttons.slice(0, 25)) {
        console.log(`   ${b.disabled ? '[x]' : '[ ]'} "${b.aria || b.text}"`);
    }
    console.log('file inputs   :', report.fileInputs.length, JSON.stringify(report.fileInputs));
    console.log('');
    console.log('Wrote', file);

    await browser.disconnect();
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
