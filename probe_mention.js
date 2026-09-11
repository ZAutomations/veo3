#!/usr/bin/env node
/**
 * MENTION MENU PROBE
 * ==================
 * The user uploaded mia_reference_sheet.jpeg as a Flow CHARACTER, so prompts
 * can reference it as @Mia. If that works, it replaces the fragile per-scene
 * ingredient attachment (open picker -> scroll virtual list -> match asset-title
 * -> "Add to prompt") with plain text in the prompt.
 *
 * To automate it we need the DOM of the "@" autocomplete dropdown.
 *
 * HOW TO RUN:
 *   1. In the automation browser, open a Flow project.
 *   2. Click into the prompt box and type  @  (just the at-sign).
 *   3. Leave the dropdown OPEN - do not click anything.
 *   4. Run:  node probe_mention.js --cdp 9222
 *
 * Read-only: it inspects the page and writes a JSON report. It never clicks,
 * types, or generates anything.
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
        console.error('Open tabs:', pages.map(p => p.url()).join('\n  '));
        process.exit(1);
    }
    console.log('Flow tab:', page.url());

    const report = await page.evaluate(() => {
        const desc = (el, depth) => {
            const cls = (el.className && el.className.toString) ? el.className.toString() : '';
            const r = el.getBoundingClientRect();
            const o = {
                tag: el.tagName.toLowerCase(),
                cls: cls.slice(0, 200),
                aria: el.getAttribute('aria-label'),
                role: el.getAttribute('role'),
                text: (el.innerText || el.textContent || '').trim().slice(0, 120),
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            };
            if (depth) o.children = [...el.children].slice(0, 25).map(c => desc(c, depth - 1));
            return o;
        };

        // 1. Overlay containers are where Angular Material renders menus.
        const overlays = [...document.querySelectorAll('.cdk-overlay-container, .cdk-overlay-pane')]
            .filter(el => el.children.length)
            .map(el => desc(el, 3));

        // 2. Anything that looks like a listbox / option list.
        const optionLists = [...document.querySelectorAll('[role="listbox"], [role="menu"], mat-option, [role="option"]')]
            .map(el => desc(el, 2));

        // 3. Anything mention/character/autocomplete shaped.
        const kw = /mention|character|autocomplete|suggestion|typeahead|cast/i;
        const suspect = [...document.querySelectorAll('*')]
            .filter(el => kw.test((el.className || '').toString()) ||
                          kw.test(el.getAttribute('aria-label') || '') ||
                          kw.test(el.getAttribute('role') || ''))
            .slice(0, 60)
            .map(el => desc(el, 1));

        // 4. The prompt editor itself.
        const editor = document.querySelector('.ProseMirror') ||
                       document.querySelector('[contenteditable="true"]');
        const editorInfo = editor ? {
            ...desc(editor, 2),
            html: (editor.innerHTML || '').slice(0, 3000),
            text: (editor.innerText || '').slice(0, 500),
        } : null;

        // 5. Buttons in the prompt box area (the @ button may be one of them).
        const promptButtons = [...document.querySelectorAll('button')]
            .filter(b => {
                const r = b.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && /^@|mention|character/i.test((b.getAttribute('aria-label') || '') + (b.innerText || ''));
            })
            .map(b => desc(b, 0));

        return {
            url: location.href,
            overlays,
            optionLists,
            suspect,
            editor: editorInfo,
            promptButtons,
        };
    });

    const outDir = path.join(__dirname, 'logs');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `mention_probe_${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));

    console.log('');
    console.log('overlay panes :', report.overlays.length, report.overlays.length ? '' : '<-- dropdown probably NOT open');
    console.log('option lists  :', report.optionLists.length);
    console.log('mention-ish   :', report.suspect.length);
    console.log('prompt editor :', report.editor ? 'found' : 'NOT found');
    console.log('prompt buttons:', report.promptButtons.length);
    console.log('');
    console.log('Wrote', file);
    console.log('Tell Claude the file is ready and it will read it.');

    await browser.disconnect();
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
