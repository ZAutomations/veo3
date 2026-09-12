#!/usr/bin/env node
/**
 * AGENT RESPONSE WATCHER  (strictly read-only)
 * ============================================
 * Attaches to the running automation browser and records what Flow Agent Mode
 * does AFTER a prompt is submitted - the storyboard, the approval prompts, the
 * generated clips. That flow has never been observed, so this is the probe.
 *
 * IT CLICKS NOTHING. No typing, no approvals, no navigation. It only reads the
 * page and writes snapshots. Safe to run while you drive the browser by hand -
 * in fact that is the point: you click, it records.
 *
 * Usage:
 *   node agent_watch.js                 watch for 20 minutes
 *   node agent_watch.js --mins 45
 *   node agent_watch.js --every 3       poll every 3s
 *   node agent_watch.js --cdp 9222
 *
 * Stop with Ctrl+C. Snapshots land in logs/agent_watch_<ts>/.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise(r => setTimeout(r, ms));
function ts() { return new Date().toTimeString().slice(0, 8); }
function log(m) { console.log(`[${ts()}] ${m}`); }

const argv = process.argv.slice(2);
function flag(name, def = null) {
    const i = argv.indexOf(name);
    if (i < 0) return def;
    const v = argv[i + 1];
    return (v && !v.startsWith('--')) ? v : true;
}
const CDP_URL = `http://127.0.0.1:${flag('--cdp', '9222')}`;
const MINS = parseFloat(flag('--mins', '20'));
const EVERY = parseFloat(flag('--every', '4'));

const RUN_DIR = path.join(__dirname, 'logs',
    `agent_watch_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);

// What changed since last poll, and anything that looks like a decision point.
function scanFn() {
    const cls = (el) => (el.className && el.className.toString) ? el.className.toString() : '';
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

    const chip = document.querySelector('flow-agent-mode-toggle-chip');
    const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
            || document.querySelector('.ProseMirror');

    const buttons = [...document.querySelectorAll('button')]
        .filter(vis)
        .map(b => ({
            aria: b.getAttribute('aria-label'),
            text: (b.innerText || '').trim().slice(0, 60),
            cls: cls(b).slice(0, 130),
            disabled: b.disabled || /mat-mdc-button-disabled/.test(cls(b)),
        }))
        .filter(b => b.aria || b.text);

    // Storyboard / scene-plan shapes. None of these have ever been seen, so the
    // keyword net is deliberately wide - the first hit tells us the real names.
    const kw = /storyboard|scene|shot|plan|card|approv|confirm|proposal|outline|step|timeline|clip|status|progress/i;
    const shaped = [...document.querySelectorAll('*')]
        .filter(el => kw.test(cls(el)))
        .filter(vis)
        .slice(0, 70)
        .map(el => {
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName.toLowerCase(),
                cls: cls(el).slice(0, 150),
                text: (el.innerText || '').trim().slice(0, 200),
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            };
        });

    const media = {
        video: document.querySelectorAll('flow-video-tile').length,
        image: document.querySelectorAll('flow-image-tile').length,
    };

    return {
        url: location.href,
        agentOn: !!(chip && /checked/.test(cls(chip))),
        promptText: pm ? (pm.innerText || '').slice(0, 600) : null,
        overlays: [...document.querySelectorAll('.cdk-overlay-pane')].filter(vis).length,
        buttons,
        shaped,
        media,
        tail: (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(-3000),
    };
}

(async () => {
    fs.mkdirSync(RUN_DIR, { recursive: true });

    const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages.find(p => /flow\.google\.com/i.test(p.url() || ''));
    if (!page) {
        console.error('No Flow tab found. Open a Flow project first.');
        console.error('Open tabs:\n  ' + pages.map(p => p.url()).join('\n  '));
        process.exit(1);
    }

    console.log('='.repeat(70));
    console.log('AGENT RESPONSE WATCHER - read only, clicks nothing');
    console.log('='.repeat(70));
    log(`Flow tab : ${page.url()}`);
    log(`Duration : ${MINS} min   Poll: ${EVERY}s`);
    log(`Snapshots: ${RUN_DIR}`);
    log('Drive the browser by hand. Ctrl+C to stop.');
    console.log('');

    let n = 0;
    let lastTail = '';
    let lastButtons = '';
    let lastMedia = '';
    const t0 = Date.now();

    // Baseline immediately, so we can prove what the page looked like on attach.
    const base = await page.evaluate(scanFn);
    fs.writeFileSync(path.join(RUN_DIR, `${String(++n).padStart(2, '0')}_attach.json`),
        JSON.stringify(base, null, 2));
    log(`Attached. Media: video=${base.media.video} image=${base.media.image}`);
    log(`Prompt box reads: "${(base.promptText || '').slice(0, 90)}"`);

    while ((Date.now() - t0) / 1000 / 60 < MINS) {
        await wait(EVERY * 1000);
        let cur;
        try {
            cur = await page.evaluate(scanFn);
        } catch (e) {
            log(`page read failed (${e.message.slice(0, 60)}) - retrying`);
            continue;
        }
        const el = Math.round((Date.now() - t0) / 1000);
        let changed = false;

        // New text on screen: the agent's replies land here.
        if (cur.tail !== lastTail) {
            const prev = new Set((lastTail || '').split('\n').map(s => s.trim()).filter(Boolean));
            const added = cur.tail.split('\n').map(s => s.trim()).filter(Boolean).filter(s => !prev.has(s));
            lastTail = cur.tail;
            changed = true;
            if (added.length) {
                log(`--- new text @${el}s ---`);
                for (const line of added.slice(-12)) log(`   | ${line.slice(0, 150)}`);
            }
        }

        // Buttons appearing/vanishing = a decision point is on screen.
        const bk = cur.buttons.map(b => `${b.disabled ? 'x' : 'o'}:${b.aria || b.text}`).join('|');
        if (bk !== lastButtons) {
            lastButtons = bk;
            changed = true;
        }

        if (cur.media.video !== base.media.video || cur.media.image !== base.media.image) {
            const mk = `${cur.media.video}/${cur.media.image}`;
            if (mk !== lastMedia) {
                lastMedia = mk;
                log(`MEDIA CHANGED @${el}s -> video=${cur.media.video} image=${cur.media.image}`);
                changed = true;
            }
        }

        if (cur.overlays) log(`@${el}s ${cur.overlays} overlay pane(s) open`);

        if (changed) {
            const f = path.join(RUN_DIR, `${String(++n).padStart(2, '0')}_t${el}s.json`);
            fs.writeFileSync(f, JSON.stringify(cur, null, 2));

            // Approval-looking controls are the thing we must understand, so
            // call them out loudly - but never press them.
            const appr = cur.buttons.filter(b =>
                b.aria && /approv|confirm|proceed|go ahead|looks good|yes|continue|generate|create/i.test(b.aria) &&
                !b.disabled &&
                !/^(Settings|Agent instructions|Start generation|Home|Search|Favorite|Expand|Clear prompt)$/i.test(b.aria));
            if (appr.length) {
                log(`>>> DECISION ON SCREEN: ${appr.map(a => `"${a.aria}"`).join(', ')}`);
                log(`>>> (watcher will not click - you decide)`);
            }

            // Storyboard-shaped nodes: report the class names the first time.
            const interesting = cur.shaped.filter(s => /storyboard|scene|shot|plan|card/i.test(s.cls));
            if (interesting.length && n <= 12) {
                log(`--- ${interesting.length} storyboard/scene-shaped node(s) ---`);
                for (const s of interesting.slice(0, 10)) {
                    log(`   ${s.tag} [${s.cls.split(' ').slice(0, 2).join(' ')}] "${(s.text || '').slice(0, 80)}"`);
                }
            }
        }
    }

    const fin = await page.evaluate(scanFn);
    fs.writeFileSync(path.join(RUN_DIR, `${String(++n).padStart(2, '0')}_final.json`),
        JSON.stringify(fin, null, 2));

    console.log('');
    console.log('='.repeat(70));
    log(`WATCH ENDED - ${n} snapshots in ${RUN_DIR}`);
    log(`Final media: video=${fin.media.video} image=${fin.media.image}`);
    log('Tell Claude the watch ended and it will read the snapshots.');

    await browser.disconnect();
})().catch(e => { console.error('WATCH FAILED:', e.message); process.exit(1); });
