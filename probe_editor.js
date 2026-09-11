#!/usr/bin/env node
/**
 * EDITOR DOM PROBE
 * =================
 * Dumps the Flow scene-editor timeline structure so we can find a RELIABLE
 * selector for "the newest clip". Timeline clips are DOM (div.clip inside
 * .timeline-contents); the only <canvas> is the video preview.
 *
 * Run it while the scene editor is open in the automation browser:
 *
 *   node probe_editor.js [--cdp 9222]
 *
 * It writes logs/editor_probe_<timestamp>.json and prints a summary. The JSON
 * is safe to paste back - it contains only DOM structure, no account data.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const cdpIdx = process.argv.indexOf('--cdp');
const CDP = cdpIdx > -1
    ? `http://127.0.0.1:${process.argv[cdpIdx + 1]}`
    : 'http://127.0.0.1:9222';

function describe(el) {
    const cls = (el.className && el.className.toString) ? el.className.toString() : '';
    const r = el.getBoundingClientRect();
    return {
        tag: el.tagName.toLowerCase(),
        cls: cls.slice(0, 160),
        aria: el.getAttribute('aria-label'),
        role: el.getAttribute('role'),
        text: (el.innerText || '').trim().slice(0, 60),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
}

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages.find(p => /\/project\/[0-9a-f-]+\/(scene|edit)\//i.test(p.url() || ''));
    if (!page) {
        console.error('No editor tab found. Open the Flow scene editor, then re-run.');
        console.error('Open tabs:', pages.map(p => p.url()).join('\n  '));
        process.exit(1);
    }
    console.log('Editor tab:', page.url());

    const report = await page.evaluate(() => {
        const kw = /clip|timeline|segment|scene|track|playhead|play-head|canvas|extend|scrub/i;

        const candidates = [...document.querySelectorAll('*')]
            .filter(el => kw.test((el.className || '').toString()) ||
                          kw.test(el.getAttribute('aria-label') || '') ||
                          kw.test(el.tagName))
            .slice(0, 150)
            .map(el => {
                const cls = (el.className && el.className.toString) ? el.className.toString() : '';
                const r = el.getBoundingClientRect();
                return {
                    tag: el.tagName.toLowerCase(),
                    cls: cls.slice(0, 160),
                    aria: el.getAttribute('aria-label'),
                    role: el.getAttribute('role'),
                    text: (el.innerText || '').trim().slice(0, 60),
                    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                };
            });

        // The extend placeholder is our only known timeline anchor - walk up
        // from it to learn the real structure of the timeline.
        const slot = document.querySelector('.extend-placeholder-text');
        const extendSlot = slot ? {
            tag: slot.tagName.toLowerCase(),
            cls: (slot.className || '').toString(),
            text: (slot.innerText || '').trim().slice(0, 80),
            rect: (r => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }))(slot.getBoundingClientRect()),
        } : null;

        const ancestors = [];
        for (let p = slot, i = 0; p && i < 10; i++, p = p.parentElement) {
            const r = p.getBoundingClientRect();
            ancestors.push({
                tag: p.tagName.toLowerCase(),
                cls: ((p.className || '').toString()).slice(0, 160),
                aria: p.getAttribute('aria-label'),
                children: p.children.length,
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            });
        }

        const canvases = [...document.querySelectorAll('canvas')].map(c => {
            const r = c.getBoundingClientRect();
            return {
                cls: (c.className || '').toString(),
                id: c.id,
                w: c.width, h: c.height,
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                parentCls: ((c.parentElement && c.parentElement.className) || '').toString().slice(0, 120),
            };
        });

        // Any horizontally scrollable container = the timeline scroller.
        const scrollers = [...document.querySelectorAll('div')]
            .filter(el => {
                const ox = getComputedStyle(el).overflowX;
                return (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 4;
            })
            .slice(0, 15)
            .map(el => {
                const r = el.getBoundingClientRect();
                return {
                    cls: (el.className || '').toString().slice(0, 160),
                    scrollLeft: Math.round(el.scrollLeft),
                    scrollWidth: Math.round(el.scrollWidth),
                    clientWidth: Math.round(el.clientWidth),
                    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                };
            });

        const readouts = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) {
            const t = w.currentNode.textContent.trim();
            if (/^\d{2}:\d{2}(:\d{2}){0,2}$/.test(t)) {
                const pe = w.currentNode.parentElement;
                const r = pe.getBoundingClientRect();
                readouts.push({
                    text: t,
                    parentCls: ((pe.className || '').toString()).slice(0, 120),
                    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                });
            }
        }

        const selectable = [...document.querySelectorAll('[aria-selected], [role="option"], [role="listitem"]')]
            .slice(0, 60)
            .map(el => {
                const r = el.getBoundingClientRect();
                return {
                    tag: el.tagName.toLowerCase(),
                    cls: ((el.className || '').toString()).slice(0, 140),
                    aria: el.getAttribute('aria-label'),
                    selected: el.getAttribute('aria-selected'),
                    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                };
            });

        return { url: location.href, candidates, extendSlot, ancestors, canvases, scrollers, readouts, selectable };
    });

    const outDir = path.join(__dirname, 'logs');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `editor_probe_${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));

    console.log('');
    console.log('extend slot  :', report.extendSlot ? 'FOUND' : 'not on timeline right now');
    console.log('candidates   :', report.candidates.length);
    console.log('canvases     :', report.canvases.length);
    console.log('scrollers    :', report.scrollers.length);
    console.log('readouts     :', report.readouts.length);
    console.log('selectable   :', report.selectable.length);
    console.log('');
    console.log('Wrote', file);
    console.log('Paste that file back (or let me read it) and I can pick the real selector.');

    await browser.disconnect();
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
