#!/usr/bin/env node
/**
 * PROBE / DRAFT - the Flow controls a reference-image generator must drive
 * =======================================================================
 * The automation is: Agent Mode OFF -> paste a prompt -> Start generation ->
 * rename the new tile -> Agent Mode ON. Two of those are already known from the
 * first probe (.ProseMirror, button[aria-label="Start generation"], the agent
 * chip). The tile menu and the Rename dialog are NOT, and an empty project has
 * no tile to inspect.
 *
 * So this can GENERATE ONE image on purpose and then dump the tile, its menu and
 * the Rename dialog. That is the last thing missing.
 *
 * Usage:
 *   node probe_refs.js                  # read-only dump of the controls
 *   node probe_refs.js --settings       # also open the Settings (tune) menu and dump it
 *   node probe_refs.js --draft "a red apple on a wooden table"
 *                                       # turn Agent OFF, generate that one image,
 *                                       # then dump the tile + menu + Rename dialog
 *   node probe_refs.js --cdp 9222
 *
 * --draft spends ONE image generation. Everything else spends nothing.
 */

const puppeteer = require('puppeteer');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
function flag(name, def = null) {
    const i = argv.indexOf(name);
    if (i < 0) return def;
    const v = argv[i + 1];
    return (v && !v.startsWith('--')) ? v : true;
}
const CDP_PORT = String(flag('--cdp', '9222'));
const SETTINGS = !!flag('--settings', false);
const RENAME_ONLY = !!flag('--rename-only', false);
const DRAFT = typeof flag('--draft') === 'string' ? flag('--draft') : '';

// Any generated media tile carries these action buttons; find the tile by them
// rather than by a guessed tag, and print the ancestor chain so the class can be
// pinned.
const TILE_BUTTON_HINT = 'button[aria-label="More options"], button[aria-label="Favorite"], button[aria-label="Reuse prompt"]';

async function dumpTiles(page, label) {
    const info = await page.evaluate(() => {
        // A generated media tile is the ancestor that carries the hover overlay;
        // the header's own More-options button sits in .header-right-container and
        // must not be mistaken for a tile.
        const moreBtns = [...document.querySelectorAll('button[aria-label="More options"]')]
            .filter((b) => !b.closest('.header-right-container, .header-desktop-main-row')
                       && !!b.closest('[class*=hover-overlay]'));
        return moreBtns.map((b, i) => {
            const tile = b.closest('[class*=hover-overlay]');
            const r = tile ? tile.getBoundingClientRect() : { width: 0, height: 0 };
            return {
                i,
                tileCls: tile ? String(tile.className).slice(0, 90) : '?',
                w: Math.round(r.width), h: Math.round(r.height),
                isImage: !!(tile && tile.querySelector('img')),
                isVideo: !!(tile && tile.querySelector('video')),
                buttons: tile ? [...tile.querySelectorAll('button')]
                    .map((x) => x.getAttribute('aria-label') || (x.innerText || '').trim().slice(0, 18)) : [],
            };
        });
    });
    console.log(`\n=== media tiles ${label} (${info.length}) ===`);
    info.slice(0, 8).forEach((t) => {
        console.log(` [${t.i}] <${t.tileCls}> ${t.w}x${t.h} img=${t.isImage} video=${t.isVideo}`);
        console.log('      buttons: ' + t.buttons.map((b) => `"${b}"`).join(', '));
    });
    if (info.length > 8) console.log(` ... and ${info.length - 8} more`);
    return info.length;
}

async function dumpPanes(page, title) {
    const panes = await page.evaluate(() => {
        const ps = [...document.querySelectorAll('.cdk-overlay-pane, [role="menu"], [role="dialog"], [role="listbox"], mat-menu, .mat-mdc-menu-panel, mat-dialog-container, .mat-mdc-select-panel, [class*=popover], [class*=settings-panel], [class*=menu-panel]')];
        return ps.map((p) => ({
            text: (p.innerText || '').trim().replace(/\n/g, ' | ').slice(0, 500),
            items: [...p.querySelectorAll('[role="menuitem"], [role="radio"], button, mat-icon, .item-text, li, mat-option')]
                .map((el) => ({
                    tag: el.tagName.toLowerCase(),
                    cls: String(el.className || '').slice(0, 70),
                    checked: el.getAttribute('aria-checked') || el.getAttribute('aria-selected') || '',
                    text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50),
                })).filter((x) => x.text),
        })).filter((p) => p.text || p.items.length);
    });
    console.log(`\n=== ${title} (${panes.length} pane(s)) ===`);
    panes.forEach((m, i) => {
        console.log(`  pane ${i}: ${JSON.stringify(m.text).slice(0, 240)}`);
        m.items.forEach((it) => console.log(`     [${it.tag}.${it.cls}${it.checked ? ' ' + it.checked : ''}] "${it.text}"`));
    });
    return panes;
}

async function setAgent(page, wantOn) {
    const state = await page.evaluate((on) => {
        const wrap = document.querySelector('flow-agent-mode-toggle-chip, [class*=agent-mode-toggle]');
        if (!wrap) return { ok: false, why: 'no agent chip' };
        const isOn = String(wrap.className).includes('checked');
        if (isOn === on) return { ok: true, changed: false, isOn };
        const btn = wrap.querySelector('button') || wrap;
        btn.click();
        return { ok: true, changed: true, was: isOn };
    }, wantOn);
    if (state.changed) await wait(2500);
    const after = await page.evaluate(() => {
        const wrap = document.querySelector('flow-agent-mode-toggle-chip, [class*=agent-mode-toggle]');
        return wrap ? String(wrap.className).includes('checked') : null;
    });
    console.log(`agent mode -> ${wantOn ? 'ON' : 'OFF'}: ${JSON.stringify(state)} nowOn=${after}`);
    return after === wantOn;
}

async function generate(page, prompt) {
    // Focus the prompt box and insert the text in one go (like a paste), so a
    // long sheet prompt does not take ten seconds of simulated keystrokes.
    const focused = await page.evaluate(() => {
        const box = document.querySelector('flow-base-prompt-box .ProseMirror, .ProseMirror, [contenteditable="true"]');
        if (!box) return false;
        box.focus();
        return true;
    });
    if (!focused) { console.error('no prompt box'); return false; }
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    // Insert the whole prompt in one go. keyboard.insertText is missing on some
    // Puppeteer builds, so use the CDP command it wraps and fall back to typing.
    let inserted = false;
    try {
        const client = (typeof page.createCDPSession === 'function')
            ? await page.createCDPSession()
            : await page.target().createCDPSession();
        await client.send('Input.insertText', { text: prompt });
        await client.detach().catch(() => {});
        inserted = true;
    } catch (e) {
        await page.keyboard.type(prompt, { delay: 2 });
    }
    console.log('prompt inserted:', inserted ? 'via CDP insertText' : 'via keyboard.type');
    await wait(1200);
    const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')]
            .find((x) => /start generation/i.test(x.getAttribute('aria-label') || ''));
        if (!b) return { ok: false, why: 'no Start generation' };
        if (b.disabled || b.className.includes('disabled')) return { ok: false, why: 'start still disabled' };
        b.click();
        return { ok: true };
    });
    console.log('generate:', JSON.stringify(clicked));
    return clicked.ok;
}

(async () => {
    let browser;
    try {
        browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}`, defaultViewport: null });
    } catch (e) {
        console.error(`Could not connect to Chrome on CDP port ${CDP_PORT}. Start the automation browser first.`);
        process.exit(1);
    }
    const page = (await browser.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) { console.error('No Flow PROJECT tab open (need /project/<id>).'); await browser.disconnect(); process.exit(1); }
    console.log('URL:', page.url());

    const chip = await page.evaluate(() => {
        const wrap = document.querySelector('flow-agent-mode-toggle-chip, [class*=agent-mode-toggle]');
        return wrap ? { cls: String(wrap.className), on: String(wrap.className).includes('checked') } : null;
    });
    console.log('agent mode:', JSON.stringify(chip));

    if (SETTINGS) {
        const hit = await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')]
                .find((x) => /^settings$/i.test(x.getAttribute('aria-label') || '') || (x.innerText || '').trim() === 'tune');
            if (!b) return false;
            b.click();
            return true;
        });
        console.log('settings button clicked:', hit);
        await wait(3500);
        await dumpPanes(page, 'SETTINGS menu');
        await page.keyboard.press('Escape');
        await wait(500);
    }

    if (RENAME_ONLY) {
        // Free: no generation. Opens the newest tile's Rename and dumps the whole
        // dialog so the name field can be pinned.
        const opened = await page.evaluate(() => {
            const more = [...document.querySelectorAll('button[aria-label="More options"]')]
                .filter((b) => !b.closest('.header-right-container, .header-desktop-main-row')
                           && !!b.closest('[class*=hover-overlay]'))[0];
            if (!more) return { ok: false, why: 'no media tile with More options' };
            more.click();
            return { ok: true };
        });
        console.log('open More options:', JSON.stringify(opened));
        await wait(2000);
        const ren = await page.evaluate(() => {
            const el = [...document.querySelectorAll('button.mat-mdc-menu-item, .item-text, [role="menuitem"]')]
                .find((x) => /^rename$/i.test((x.innerText || '').trim()));
            if (!el) return false;
            el.click();
            return true;
        });
        console.log('clicked Rename:', ren);
        await wait(2500);
        const tree = await page.evaluate(() => {
            const panes = [...document.querySelectorAll('.cdk-overlay-pane, [role="dialog"]')];
            const out = [];
            for (const p of panes) {
                const r = p.getBoundingClientRect();
                if (r.width < 60 || r.height < 30) continue;
                const nodes = [];
                const walk = (el, depth) => {
                    if (depth > 7 || nodes.length > 80) return;
                    const rr = el.getBoundingClientRect();
                    if (rr.width < 2 && rr.height < 2) return;
                    nodes.push({
                        d: depth,
                        tag: el.tagName.toLowerCase(),
                        cls: String(el.className || '').slice(0, 60),
                        ce: el.getAttribute('contenteditable'),
                        role: el.getAttribute('role') || '',
                        ph: el.getAttribute('placeholder') || '',
                        aria: el.getAttribute('aria-label') || '',
                        val: String(el.value !== undefined ? el.value : (el.innerText || ''))
                            .replace(/\s+/g, ' ').slice(0, 40),
                    });
                    for (const c of el.children) walk(c, depth + 1);
                };
                walk(p, 0);
                out.push({ w: Math.round(r.width), h: Math.round(r.height), nodes });
            }
            return out;
        });
        console.log('\n=== RENAME dialog tree ===');
        tree.forEach((t, i) => {
            console.log(`-- pane ${i} ${t.w}x${t.h} --`);
            t.nodes.forEach((n) => console.log(
                `   ${'  '.repeat(n.d)}<${n.tag} class="${n.cls}"`
                + `${n.ce !== null ? ` contenteditable="${n.ce}"` : ''}`
                + `${n.role ? ` role="${n.role}"` : ''}`
                + `${n.ph ? ` ph="${n.ph}"` : ''}`
                + `${n.aria ? ` aria="${n.aria}"` : ''}> "${n.val}"`));
        });
        await page.keyboard.press('Escape');
        await wait(500);
        await page.keyboard.press('Escape');
    }

    if (DRAFT) {
        console.log('\n--- draft run: one throwaway image ---');
        console.log('Before tiles:');
        const beforeN = await dumpTiles(page, '(before)');
        await setAgent(page, false);          // Agent Mode OFF
        const ok = await generate(page, DRAFT);
        if (ok) {
            console.log('waiting for a new tile (up to 150s)...');
            const t0 = Date.now();
            let n = beforeN;
            while ((Date.now() - t0) / 1000 < 150) {
                n = await page.evaluate(() => [...document.querySelectorAll('button[aria-label="More options"]')]
                    .filter((b) => !b.closest('.header-right-container, .header-desktop-main-row')
                               && !!b.closest('[class*=hover-overlay]')).length);
                if (n > beforeN) break;
                await wait(4000);
            }
            console.log(`tiles after ${Math.round((Date.now() - t0) / 1000)}s: ${n} (was ${beforeN})`);
            await dumpTiles(page, '(after)');

            // The newest tile is first in the grid.
            const opened = await page.evaluate(() => {
                const more = [...document.querySelectorAll('button[aria-label="More options"]')]
                    .filter((b) => !b.closest('.header-right-container, .header-desktop-main-row')
                               && !!b.closest('[class*=hover-overlay]'))[0];
                if (!more) return { ok: false, why: 'no media tile More options' };
                more.click();
                return { ok: true };
            });
            console.log('open More options:', JSON.stringify(opened));
            await wait(2000);
            await dumpPanes(page, 'TILE menu');

            const ren = await page.evaluate(() => {
                const el = [...document.querySelectorAll('[role="menuitem"], button, .item-text, span, li')]
                    .find((x) => /^rename$/i.test((x.innerText || '').trim()));
                if (!el) return false;
                el.click();
                return true;
            });
            console.log('clicked Rename:', ren);
            await wait(1800);
            await dumpPanes(page, 'RENAME dialog');
            await page.keyboard.press('Escape');
            await wait(600);
            await page.keyboard.press('Escape');
            await setAgent(page, true);           // Agent Mode back ON
        }
    } else {
        await dumpTiles(page, '');
    }

    console.log('\nDone. Send this whole output back.');
    await browser.disconnect();
})().catch((e) => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });
