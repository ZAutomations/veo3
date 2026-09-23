#!/usr/bin/env node
/**
 * EXTEND MENU PROBE
 * =================
 * Answers ONE question, in about five seconds, without generating anything:
 *
 *   Does this Google account's Flow plan offer "Extend (Veo ...)" at all?
 *
 * Why it exists. The ingredients/extend engine (veo3_flow_new_ui.js) was parked
 * because armExtend could not find an Extend entry in the "Add clip" menu, and
 * the log it left behind read "Extend menu problem: undefined" - which says
 * nothing about what the menu actually held. That single uninformative line is
 * the reason the whole path was set aside. This probe replaces it with the
 * contents of the menu itself.
 *
 * It is READ-ONLY apart from clicking "Add clip" (which only opens a menu) and
 * pressing Escape afterwards to close it. Nothing is generated and no credits
 * are spent.
 *
 * Run it with the automation browser already open (START_CHROME_CDP.bat) and
 * signed in, sitting on a Flow project:
 *
 *   node probe_extend.js [--cdp 9222] [--extend-model "Veo 3.1 - Lite"]
 *
 * It writes logs/extend_probe_<timestamp>.json and prints a verdict. The JSON
 * holds DOM structure only - no account data - so it is safe to share.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const remoteConfig = require('./remote_config.js');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const CDP = `http://127.0.0.1:${arg('--cdp', '9222')}`;
// Substring, matching how the engine matches: it prefers this model but falls
// back to any Veo extend entry, so a plan change cannot stall a run.
const WANT_MODEL = arg('--extend-model', 'Veo 3.1 - Lite');

const cfg = remoteConfig.load();
const sel = cfg.selectors;
console.log(`Selectors from: ${cfg.sources.join(' -> ')}`);

const isEditorUrl = (u) => /\/project\/[0-9a-f-]+\/(scene|edit)\//i.test(u || '');
const isProjectUrl = (u) => /flow\.google\.com\/project/i.test(u || '');

function describe(el) {
    const cls = (el.className && el.className.toString) ? el.className.toString() : '';
    const r = el.getBoundingClientRect();
    return {
        tag: el.tagName.toLowerCase(),
        cls: cls.slice(0, 120),
        aria: el.getAttribute('aria-label'),
        role: el.getAttribute('role'),
        text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
}

(async () => {
    const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
    let pages = await browser.pages();

    let page = pages.find(p => isEditorUrl(p.url()));
    if (!page) {
        const proj = pages.find(p => isProjectUrl(p.url()));
        if (!proj) {
            console.error('No Flow project or editor tab found.');
            console.error('Open tabs:');
            for (const p of pages) console.error('  ' + (p.url() || '(blank)'));
            console.error('\nStart the automation browser (START_CHROME_CDP.bat), open a Flow');
            console.error('project, and re-run.');
            process.exit(1);
        }
        // Self-recover the same way the engine does: click the newest tile.
        console.log('On the project grid - clicking the newest tile to open the editor...');
        page = proj;
        const clicked = await page.evaluate((s) => {
            const tiles = [...document.querySelectorAll(s.videoTileSelector)];
            if (!tiles.length) return false;
            const last = tiles[tiles.length - 1];
            (last.querySelector('img, video') || last).click();
            return true;
        }, sel).catch(() => false);
        if (!clicked) {
            console.error('No clip tiles on the project page. Generate one clip first,');
            console.error('or open the scene editor by hand and re-run.');
            process.exit(1);
        }
        await wait(9000);
        pages = await browser.pages();
        page = pages.find(p => isEditorUrl(p.url()));
        if (!page) {
            console.error('Editor did not open. Open it by hand, then re-run.');
            process.exit(1);
        }
    }

    console.log('Editor tab:', page.url());

    // The editor hydrates slowly (canvas + buttons). Wait for "Add clip".
    const deadline = Date.now() + 120000;
    let ready = false;
    while (Date.now() < deadline) {
        ready = await page.evaluate((s) => [...document.querySelectorAll('button')]
            .some(b => (b.getAttribute('aria-label') || '') === s.addClipLabel), sel).catch(() => false);
        if (ready) break;
        await wait(3000);
    }

    const report = {
        probed_at: new Date().toISOString(),
        url: page.url(),
        selector_sources: cfg.sources,
        wanted_model: WANT_MODEL,
        add_clip_found: ready,
    };

    if (!ready) {
        // Do not just fail: dump every button label so a RENAMED button is
        // visible at a glance. That is a selectors.json fix, not a dead end.
        report.all_button_labels = await page.evaluate(() =>
            [...document.querySelectorAll('button')]
                .map(b => (b.getAttribute('aria-label') || b.innerText || '').trim().replace(/\s+/g, ' '))
                .filter(Boolean).slice(0, 80)).catch(() => []);
        finish(report, 'ADD CLIP BUTTON NOT FOUND');
        return;
    }

    // Open the menu. This is the only click; it generates nothing.
    await page.evaluate((s) => {
        const b = [...document.querySelectorAll('button')]
            .find(x => (x.getAttribute('aria-label') || '') === s.addClipLabel);
        if (b) b.click();
    }, sel);

    // Poll for the overlay rather than sleeping a fixed amount: a slow menu
    // would otherwise read as an empty one.
    let entries = [];
    const menuDeadline = Date.now() + 20000;
    while (Date.now() < menuDeadline) {
        entries = await page.evaluate((s) => {
            const ov = document.querySelector(s.overlayContainerSelector);
            if (!ov) return [];
            return [...ov.querySelectorAll('button, [role=menuitem], a, [role=option], li')]
                .filter(el => (el.innerText || '').trim())
                .map(el => {
                    const cls = (el.className && el.className.toString) ? el.className.toString() : '';
                    return {
                        tag: el.tagName.toLowerCase(),
                        cls: cls.slice(0, 120),
                        aria: el.getAttribute('aria-label'),
                        role: el.getAttribute('role'),
                        text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
                    };
                });
        }, sel).catch(() => []);
        if (entries.length) break;
        await wait(1000);
    }

    report.menu_entries = entries;
    report.overlay_html_sample = await page.evaluate((s) => {
        const ov = document.querySelector(s.overlayContainerSelector);
        return ov ? ov.outerHTML.slice(0, 4000) : null;
    }, sel).catch(() => null);

    // Close the menu so the editor is left exactly as we found it.
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => document.body.click()).catch(() => {});

    const extendItems = entries.filter(e => /extend/i.test(e.text) && /veo/i.test(e.text));
    report.extend_items = extendItems;
    report.preferred_model_offered = extendItems.some(e => e.text.includes(WANT_MODEL));

    if (!entries.length) {
        finish(report, 'NO MENU APPEARED AFTER CLICKING ADD CLIP');
    } else if (!extendItems.length) {
        finish(report, 'NO EXTEND OFFERED');
    } else {
        finish(report, 'EXTEND AVAILABLE');
    }

    function finish(rep, verdict) {
        fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const out = path.join(__dirname, 'logs', `extend_probe_${stamp}.json`);
        fs.writeFileSync(out, JSON.stringify(rep, null, 2), 'utf8');

        console.log('\n' + '='.repeat(70));
        console.log(`VERDICT: ${verdict}`);
        console.log('='.repeat(70));

        if (verdict === 'EXTEND AVAILABLE') {
            console.log('This account CAN use the extend path. Models offered:');
            for (const e of rep.extend_items) console.log('  - ' + e.text);
            console.log('');
            console.log(rep.preferred_model_offered
                ? `"${WANT_MODEL}" is offered - the engine's default will be picked.`
                : `"${WANT_MODEL}" is NOT offered. The engine falls back to any Veo extend\n`
                  + `entry, so it will still run - it just logs which one it took. To pin it,\n`
                  + `pass --extend-model "<one of the labels above>".`);
            console.log('');
            console.log('Next: run the ingredients engine on a story JSON.');
            console.log('  node veo3_flow_new_ui.js <story.json> --project-url <url>');
            console.log('or use the GUI tab "Ingredients (extend)".');
        } else if (verdict === 'NO EXTEND OFFERED') {
            console.log('The menu opened, but it contains no "Extend (Veo ...)" entry.');
            console.log('This is the plan limitation the extend path was parked on.');
            console.log('');
            console.log('The menu actually holds:');
            for (const e of rep.menu_entries) console.log('  - ' + (e.text || e.aria || e.tag));
            console.log('');
            console.log('If one of those IS an extend entry under a different wording, the');
            console.log('match is too narrow. It is a one-line fix in selectors.json - but the');
            console.log('match is in veo3_flow_new_ui.js armExtend, so send this file back.');
        } else if (verdict === 'NO MENU APPEARED AFTER CLICKING ADD CLIP') {
            console.log('"Add clip" was clicked but no overlay content appeared.');
            console.log('Either the click did not register, or the overlay container selector');
            console.log(`is wrong. It is currently "${sel.overlayContainerSelector}" - override it`);
            console.log('in selectors.json and re-run.');
        } else {
            console.log(`No button with aria-label "${sel.addClipLabel}" on the page.`);
            console.log('The button has probably been renamed. Every label found:');
            for (const l of (rep.all_button_labels || [])) console.log('  - ' + l);
            console.log('');
            console.log('Set "addClipLabel" in selectors.json to the right one and re-run.');
        }

        console.log('\nWrote ' + out);
        browser.disconnect();
    }
})().catch((e) => {
    console.error('Probe failed:', e.message);
    process.exit(1);
});
