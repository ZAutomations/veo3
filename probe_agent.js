#!/usr/bin/env node
/**
 * AGENT MODE UI PROBE
 * ===================
 * Dumps the DOM of Flow's Agent Mode so it can be automated as a SECOND mode
 * alongside the existing ingredients/extend path (which stays untouched).
 *
 * HOW TO RUN:
 *   1. In the automation browser, open a Flow project.
 *   2. Click the "Agent" chip so Agent Mode is ON.
 *   3. If you can, also open the Agent Instructions panel (the article_spark
 *      button) so its inner DOM is captured too.
 *   4. Run:  node probe_agent.js --cdp 9222
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
                cls: cls.slice(0, 180),
                aria: el.getAttribute('aria-label'),
                role: el.getAttribute('role'),
                text: (el.innerText || el.textContent || '').trim().slice(0, 100),
                visible: r.width > 0 && r.height > 0,
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            };
            if (depth) o.children = [...el.children].slice(0, 20).map(c => desc(c, depth - 1));
            return o;
        };

        // 1. Anything agent-shaped: the chip, the instructions button, panels.
        const agentish = [...document.querySelectorAll('*')]
            .filter(el => /agent/i.test((el.className || '').toString()) ||
                          /agent/i.test(el.getAttribute('aria-label') || '') ||
                          /agent/i.test(el.tagName))
            .slice(0, 80)
            .map(el => desc(el, 1));

        // 2. The Agent chip the user identified, and everything around it.
        const chip = document.querySelector('.agent-mode-chip-label');
        const chipChain = [];
        for (let p = chip, i = 0; p && i < 6; i++, p = p.parentElement) {
            chipChain.push(desc(p, 2));
        }

        // 3. The Agent Instructions button (article_spark icon).
        const spark = [...document.querySelectorAll('mat-icon')]
            .find(m => (m.textContent || '').trim() === 'article_spark');
        const sparkInfo = spark ? (() => {
            const btn = spark.closest('button') || spark.parentElement;
            return { icon: desc(spark, 0), button: desc(btn, 1) };
        })() : null;

        // 4. The prompt box.
        const editor = document.querySelector('.ProseMirror') ||
                       document.querySelector('[contenteditable="true"]');
        const editorInfo = editor ? {
            ...desc(editor, 2),
            placeholder: (document.querySelector('.prosemirror-placeholder') || {}).textContent || null,
            html: (editor.innerHTML || '').slice(0, 2000),
        } : null;

        // 5. Storyboard / scene plan / instruction surfaces.
        const kw = /storyboard|instruction|scene-|sceneplan|plan-|guideline|chip|mention|character/i;
        const surfaces = [...document.querySelectorAll('*')]
            .filter(el => kw.test((el.className || '').toString()))
            .slice(0, 80)
            .map(el => desc(el, 1));

        // 6. Every visible button, so we can find Generate / Approve / Send.
        const buttons = [...document.querySelectorAll('button')]
            .map(b => desc(b, 0))
            .filter(b => b.visible)
            .slice(0, 80);

        return { url: location.href, agentish, chipChain, sparkInfo, editor: editorInfo, surfaces, buttons };
    });

    const outDir = path.join(__dirname, 'logs');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `agent_probe_${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));

    console.log('');
    console.log('agent-ish nodes :', report.agentish.length);
    console.log('agent chip      :', report.chipChain.length ? 'FOUND' : 'not found - is Agent Mode ON?');
    console.log('instructions btn:', report.sparkInfo ? 'FOUND (article_spark)' : 'not found - panel closed?');
    console.log('prompt editor   :', report.editor ? 'found' : 'NOT found');
    console.log('surfaces        :', report.surfaces.length);
    console.log('visible buttons :', report.buttons.length);
    console.log('');
    console.log('Wrote', file);

    await browser.disconnect();
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
