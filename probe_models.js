// READ-ONLY probe for the model dropdowns in Flow's Settings panel.
//
// Answers one question: does the code that sets the video model actually find
// the right row on a live page? It calls the same functions generate_refs.js and
// agent_mode.js call - openSettingsPanel, readImageModel, readVideoModel,
// setSectionModel - so what it reports is what a real run will do.
//
// By default it changes NOTHING: it never picks a model, never touches the
// ratio, and never clicks Save. Opening the dropdown to list its items and
// pressing Escape is the only interaction, and Escape leaves the setting as it
// was.
//
// --try-pick goes further and exercises the click, because "reads the right row"
// and "actually changes the model" are different claims and only the second one
// is the feature. It picks the model, reads the row back to prove the pick took,
// then picks the ORIGINAL model back so the panel is left as it was found, and
// still never clicks Save. If the panel only commits on Save - which is what the
// Save button implies - nothing reaches the project at all. Run it only if you
// are willing for the project's video model to change and be changed back.
//
// Needs the automation browser already open, on a Flow PROJECT tab, with CDP on
// 9222 (same as every other probe here).
//
//   node probe_models.js
//   node probe_models.js --cdp 9223
//   node probe_models.js --try-pick "Veo 3.1 - Fast"
//   node probe_models.js --try-save     (writes the settings to test if Save closes the panel)
const puppeteer = require('puppeteer');
const GR = require('./generate_refs.js');

const argv = process.argv.slice(2);
const arg = (name, def) => {
    const i = argv.indexOf(name);
    if (i < 0) return def;
    const v = argv[i + 1];
    return (v && !v.startsWith('--')) ? v : true;
};
const CDP = String(arg('--cdp', '9222'));
const TRY_PICK = arg('--try-pick', null);
const TRY_SAVE = !!arg('--try-save', false);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// What the trigger really looks like, so a wrong guess can be corrected from the
// paste rather than guessed at again.
const describeTriggers = (page) => page.evaluate(() => {
    const out = [];
    for (const sec of document.querySelectorAll('.settings-section')) {
        const heading = (sec.innerText || '').split('\n')[0].trim().slice(0, 60);
        const arrows = [...sec.querySelectorAll('button')].filter((b) =>
            [...b.querySelectorAll('mat-icon')].some((i) => /arrow_drop_down/.test(i.textContent || '')));
        const all = [...sec.querySelectorAll('button')].map((b) => {
            const c = b.cloneNode(true);
            c.querySelectorAll('mat-icon').forEach((i) => i.remove());
            return (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim();
        }).filter(Boolean);
        out.push({ heading, arrowTriggers: arrows.length, buttons: all });
    }
    return out;
});

(async () => {
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP}`, defaultViewport: null });
    const page = (await browser.pages()).find((p) => /flow\.google\.com\/project/i.test(p.url() || ''));
    if (!page) {
        console.error(`No Flow PROJECT tab found on CDP ${CDP}.`);
        console.error('Open the automation browser on a project page first.');
        await browser.disconnect();
        process.exit(1);
    }
    console.log('project :', page.url());

    await page.keyboard.press('Escape');
    await wait(700);

    // Say WHY the panel would not open rather than just reporting false. A
    // missing Settings button and a click that does not take are different
    // problems, and the page may simply not be ready yet.
    //
    // Which settings button exists depends on the page state: the tune button
    // ("Settings") or a compact "Settings trigger". Visibility is reported
    // because clicking a hidden one does nothing, which is indistinguishable
    // from the panel refusing to open unless you look.
    const diagnose = () => page.evaluate(() => {
        const describe = (el) => {
            if (!el) return 'absent';
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const hidden = !r.width && !r.height;
            return `${hidden ? 'HIDDEN' : 'visible'} (${Math.round(r.width)}x${Math.round(r.height)}` +
                   ` display=${cs.display} visibility=${cs.visibility})`;
        };
        const panel = document.querySelector('.settings-content, .settings-section');
        const pr = panel ? panel.getBoundingClientRect() : null;
        const labelled = [...document.querySelectorAll('button[aria-label]')]
            .map((b) => b.getAttribute('aria-label')).slice(0, 30);
        const overlay = document.querySelector('.cdk-overlay-pane');
        return {
            readyState: document.readyState,
            title: document.title,
            btn_Settings: describe(document.querySelector('button[aria-label="Settings"]')),
            btn_Settings_trigger: describe(document.querySelector('button[aria-label="Settings trigger"]')),
            panelPresent: !!panel,
            panelVisible: !!(pr && (pr.width || pr.height)),
            panelRect: pr ? `${Math.round(pr.width)}x${Math.round(pr.height)}` : '',
            overlayOpen: !!overlay,
            buttonCount: document.querySelectorAll('button').length,
            ariaLabels: labelled,
            bodyStart: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        };
    });

    const opened = await GR.openSettingsPanel(page);
    console.log('settings panel open:', opened);

    // closeSettings() presses Escape and clicks a corner, and reported false on a
    // live page - so the panel may not honour Escape at all. List what the
    // panel offers for closing it, rather than guessing a selector.
    //
    // Search the panel's ANCESTORS, not `.settings-content` alone: that element
    // matches [class*="settings"] itself, so closest() returns it and the search
    // never leaves it - which is how the Save button stayed invisible here.
    const closers = await page.evaluate(() => {
        const panel = document.querySelector('.settings-content, .settings-section');
        if (!panel) return { found: false };
        const chain = [];
        for (let p = panel; p && p !== document.body && chain.length < 6; p = p.parentElement) {
            chain.push({
                tag: p.tagName.toLowerCase(),
                cls: (p.className || '').toString().slice(0, 100),
                role: p.getAttribute('role') || '',
                buttons: [...p.querySelectorAll('button')].length,
            });
        }
        // Every button that shares the panel's container, wherever it sits.
        const container = panel.parentElement || panel;
        const seen = new Set();
        const buttons = [...container.querySelectorAll('button')].filter((b) => {
            if (seen.has(b)) return false;
            seen.add(b);
            return true;
        }).map((b) => ({
            aria: b.getAttribute('aria-label') || '',
            cls: (b.className || '').toString().slice(0, 80),
            text: (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        })).slice(0, 40);
        return {
            found: true,
            chain,
            buttons,
            saveLike: [...document.querySelectorAll('button')]
                .filter((b) => /^(save|cancel|close|done|apply)$/i.test((b.innerText || '').trim()))
                .map((b) => ({
                    text: (b.innerText || '').trim(),
                    cls: (b.className || '').toString().slice(0, 80),
                    inPanel: container.contains(b),
                })),
            backdrops: [...document.querySelectorAll('[class*="backdrop"], [class*="scrim"]')]
                .map((b) => (b.className || '').toString().slice(0, 80)).slice(0, 6),
        };
    });
    console.log('\n--- what can close the panel ---');
    if (!closers.found) {
        console.log('  could not locate the panel');
    } else {
        console.log('  ancestor chain (innermost first):');
        for (const c of closers.chain) {
            console.log(`    <${c.tag} class="${c.cls}"${c.role ? ` role="${c.role}"` : ''}> ${c.buttons} buttons`);
        }
        console.log('  save/cancel/close buttons anywhere on the page:');
        for (const b of closers.saveLike) {
            console.log(`    text=${JSON.stringify(b.text)} inPanel=${b.inPanel} class=${JSON.stringify(b.cls)}`);
        }
        if (!closers.saveLike.length) console.log('    (none found)');
        console.log('  backdrops:', JSON.stringify(closers.backdrops));
        console.log('  buttons in the panel container:');
        for (const b of closers.buttons) {
            console.log(`    aria=${JSON.stringify(b.aria)} text=${JSON.stringify(b.text)} class=${JSON.stringify(b.cls)}`);
        }
    }

    if (!opened) {
        console.error('Could not open the Settings panel.');
        console.error('\n--- why not ---');
        const d = await diagnose();
        for (const [k, v] of Object.entries(d)) {
            console.error(`  ${k}: ${JSON.stringify(v)}`);
        }
        console.error('\nBoth settings buttons HIDDEN or absent means the project UI is');
        console.error('not up. An overlayOpen blocked click means something covers it -');
        console.error('press Escape in the browser and run the probe again.');
        await browser.disconnect();
        process.exit(1);
    }

    console.log('\n--- what the code reads ---');
    const img = await GR.readImageModel(page);
    const vid = await GR.readVideoModel(page);
    console.log('readImageModel ->', JSON.stringify(img));
    console.log('readVideoModel ->', JSON.stringify(vid));
    console.log(img ? '  image row: found' : '  image row: NOT FOUND  <- the fallback could not name a model either');
    console.log(vid ? '  video row: found' : '  video row: NOT FOUND');

    console.log('\n--- the sections and their buttons ---');
    for (const s of await describeTriggers(page)) {
        console.log(`  [${s.heading}]`);
        console.log(`    buttons with an arrow_drop_down icon: ${s.arrowTriggers}`);
        console.log(`    button texts: ${JSON.stringify(s.buttons)}`);
    }

    // Open the video menu and read it, then Escape without choosing. This is the
    // one unknown left: the exact items and how they are marked.
    console.log('\n--- the video model menu (opened, read, then escaped) ---');
    const openedMenu = await page.evaluate(() => {
        const sec = [...document.querySelectorAll('.settings-section')]
            .find((s) => /video generation default/i.test(s.innerText || ''));
        if (!sec) return 'no video section';
        const trig = [...sec.querySelectorAll('button')].find((b) =>
            [...b.querySelectorAll('mat-icon')].some((i) => /arrow_drop_down/.test(i.textContent || '')));
        if (!trig) return 'no arrow trigger in the video section';
        trig.click();
        return 'clicked';
    });
    console.log('  trigger:', openedMenu);
    if (openedMenu === 'clicked') {
        await wait(1500);
        const items = await page.evaluate(() => {
            const els = [...document.querySelectorAll('.cdk-overlay-pane span.label, ' +
                '.cdk-overlay-pane [role="option"], mat-option, [role="listbox"] [role="option"]')];
            return els.map((el) => ({
                tag: el.tagName.toLowerCase(),
                cls: el.className,
                role: el.getAttribute('role'),
                checked: el.getAttribute('aria-selected') || el.getAttribute('aria-checked'),
                text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
            }));
        });
        console.log(`  items found: ${items.length}`);
        for (const it of items) {
            console.log(`    ${JSON.stringify(it.text)}  <${it.tag} class="${it.cls}"` +
                        `${it.role ? ` role="${it.role}"` : ''}` +
                        `${it.checked ? ` checked="${it.checked}"` : ''}>`);
        }
        if (!items.length) console.log('    (none - the menu selector needs widening; paste the overlay HTML)');
        await page.keyboard.press('Escape');
        await wait(800);
    }

    // Escape chooses nothing, and Save is never clicked, so the project is left
    // exactly as it was found.
    if (TRY_PICK) {
        const target = TRY_PICK === true ? 'Veo 3.1 - Fast' : String(TRY_PICK);
        console.log(`\n--- does a pick actually take? (target: "${target}") ---`);
        const original = await GR.readVideoModel(page);
        console.log('  model before      :', JSON.stringify(original));

        if (GR.modelKey(original) === GR.modelKey(target)) {
            console.log(`  the project is already on "${target}" - pick a different one to test the click`);
        } else {
            const r1 = await GR.setSectionModel(page, 'video', target);
            console.log('  pick result       :', JSON.stringify(r1));
            console.log('  row after pick    :', JSON.stringify(await GR.readVideoModel(page)));

            if (r1.ok && r1.changed) {
                console.log('  -> the pick took. Restoring the original model.');
                const r2 = await GR.setSectionModel(page, 'video', original);
                console.log('  restore result    :', JSON.stringify(r2));
                const back = await GR.readVideoModel(page);
                console.log('  row after restore :', JSON.stringify(back));
                if (GR.modelKey(back) !== GR.modelKey(original)) {
                    console.log(`  !! LEFT ON "${back}" - set it back to "${original}" by hand in the panel`);
                }
            } else if (r1.ok && !r1.changed) {
                console.log('  -> nothing to do (already set)');
            } else {
                console.log('  -> THE PICK FAILED: ' + r1.why);
                console.log('     the row is unchanged, so nothing needs restoring');
            }
        }
        console.log('  Save was still not clicked.');
    }

    await GR.closeSettings(page);
    // Presence in the DOM is not the same as being open - Angular can leave a
    // closed panel's nodes behind, which would make this report "still open"
    // forever. Report what is actually on screen.
    const panelState = () => page.evaluate(() => {
        const el = document.querySelector('.settings-content, .settings-section');
        if (!el) return { present: false, visible: false, rect: '' };
        const r = el.getBoundingClientRect();
        return { present: true, visible: !!(r.width || r.height),
                 rect: `${Math.round(r.width)}x${Math.round(r.height)}`,
                 at: `${Math.round(r.x)},${Math.round(r.y)}`,
                 viewport: `${window.innerWidth}x${window.innerHeight}` };
    });

    const after = await panelState();
    console.log('\npanel after closeSettings:', JSON.stringify(after));
    console.log('panel closed again:', !after.visible);

    // closeSettings() did not close it. Find out what does - closing changes no
    // setting, so trying is safe. The tell is the panel's own coordinates:
    // closeSettings ends with a click at (5,5), which lands INSIDE a left-hand
    // panel and would explain why it never worked.
    if (after.visible) {
        console.log('\n--- what actually closes the panel ---');
        const open = () => page.evaluate(() => {
            const el = document.querySelector('.settings-content, .settings-section');
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return !!(r.width || r.height);
        });
        const reopen = async () => {
            if (await open()) return true;
            await GR.openSettingsPanel(page);
            return await open();
        };

        // Each strategy gets a FRESHLY OPENED panel. Run in sequence on one
        // panel they are not independent - an earlier attempt can dismiss
        // whatever was blocking a later one, which is exactly how the backdrop
        // click read as failing once and succeeding the next run.
        const strategies = [
            ['Escape', async () => { await page.keyboard.press('Escape'); }],
            ['click outside the panel', async () => {
                const pt = await page.evaluate(() => {
                    const el = document.querySelector('.settings-content');
                    const r = el.getBoundingClientRect();
                    const x = r.x > window.innerWidth / 2 ? 10 : Math.round(r.right + 30);
                    return { x: Math.min(x, window.innerWidth - 5), y: Math.round(window.innerHeight / 2) };
                });
                await page.mouse.click(pt.x, pt.y);
            }],
            ['click the header backdrop', async () => {
                await page.evaluate(() => {
                    const b = document.querySelector('.header-backdrop, [class*="backdrop"], [class*="scrim"]');
                    if (b) b.click();
                });
            }],
            ["click the panel's close icon", async () => {
                const hit = await page.evaluate(() => {
                    const visible = (el) => {
                        const r = el.getBoundingClientRect();
                        if (!r.width && !r.height) return false;
                        const cs = getComputedStyle(el);
                        return cs.display !== 'none' && cs.visibility !== 'hidden';
                    };
                    // Not scoped to the drawer: the live close control is a
                    // document-level mdc-icon-button, outside flow-settings-view
                    // and flow-agent-panel, so a scoped search finds nothing.
                    const found = [...document.querySelectorAll('button')].filter((b) => {
                        const ic = b.querySelector('mat-icon');
                        const isClose = (ic && /^close$/i.test((ic.textContent || '').trim()))
                            || /^(close|cancel|dismiss)$/i.test((b.getAttribute('aria-label') || '').trim());
                        return isClose && visible(b);
                    });
                    if (!found.length) return null;
                    const r = found[0].getBoundingClientRect();
                    found[0].click();
                    return `${Math.round(r.x)},${Math.round(r.y)} (${found.length} candidate(s))`;
                });
                return hit ? ` at ${hit}` : ' - none found';
            }],
        ];

        const results = [];
        for (const [name, act] of strategies) {
            if (!await reopen()) { results.push([name, null, 'could not reopen the panel']); continue; }
            const extra = await act();
            await wait(1100);
            results.push([name, !await open(), extra]);
        }

        for (const [name, worked, extra] of results) {
            const mark = worked === null ? '????' : worked ? 'CLOSES' : 'no    ';
            console.log(`  ${mark}  ${name}${typeof extra === 'string' ? extra : ''}`);
        }
        const winner = results.find(([, w]) => w === true);
        console.log(winner
            ? `\n  -> use: ${winner[0]}`
            : '\n  -> nothing closes the panel except Save');

        // Save is the panel's own commit path and the only exit proven to work.
        // Opt-in because it WRITES: every setting the probe touched was put
        // back, so it saves what is already there, but that is the user's call.
        if (!winner && TRY_SAVE) {
            console.log('\n  --try-save given: clicking Save');
            if (!await reopen()) console.log('  (panel already closed)');
            const saved = await GR.clickSave(page);
            await wait(1500);
            console.log(`  Save clicked: ${saved}; panel closed: ${!await open()}`);
        } else if (!winner && !TRY_SAVE) {
            console.log('  (Save is known to close it - re-run with --try-save to confirm)');
        }
        console.log('  panel now:', JSON.stringify(await panelState()));
    }

    console.log('nothing was selected and Save was not clicked - the project is unchanged.');
    await browser.disconnect();
})().catch((e) => { console.error('PROBE FAILED: ' + (e && e.message)); process.exit(1); });
