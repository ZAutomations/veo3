#!/usr/bin/env node
/**
 * FLOW AGENT MODE DRIVER  (separate from the ingredients/extend engine)
 * ======================================================================
 * Agent Mode is a DIFFERENT surface from the ingredients path:
 *
 *   ingredients path : needs the SCENE EDITOR  (/project/<id>/edit/<scene>)
 *                      -> one continuous timeline -> ffmpeg SPLIT into scenes
 *   Agent Mode       : lives in the PROJECT MAIN WINDOW (/project/<id>)
 *                      -> the agent plans a storyboard and emits clips
 *                      -> post-processing would be ffmpeg CONCAT, not split
 *
 * So this script deliberately does NOT reuse veo3_flow_new_ui.js. That engine
 * forces the editor open (ensureEditor) and would break Agent Mode. Nothing in
 * this file reads or modifies the ingredients path.
 *
 * Selectors below were taken from a live DOM probe (logs/agent_probe_*.json),
 * not guessed:
 *   flow-agent-mode-toggle-chip           wrapper, gets class "checked" when ON
 *   button.agent-mode-chip                the clickable toggle
 *   button[aria-label="Agent instructions"]   article_spark icon
 *   button[aria-label="Settings"]         tune icon, inside .agent-footer-actions
 *   flow-base-prompt-box .ProseMirror     the prompt editor
 *   button[aria-label="Start generation"] arrow_forward, disabled while empty
 *
 * WHAT WE HAVE NOT SEEN YET: the storyboard / approval UI, because nothing has
 * been submitted on this account yet. Rather than guess it, every run writes a
 * numbered DOM snapshot at each stage into logs/agent_run_<ts>/. The FIRST run
 * is therefore also the probe for the rest of the flow.
 *
 * MODEL LIMITS (stated by the agent itself, 2026-09-11) - prompt accordingly:
 *   - Veo 3.1 - Lite [Lower Priority] makes AT MOST 8 SECONDS PER CLIP. Asking for a
 *     single "15-second" video makes the agent refuse or re-plan, because no single
 *     clip on this model can be that long.
 *   - Veo 3.1 accepts AT MOST 3 REFERENCE IMAGES (R2V). A multi-angle character
 *     SHEET can count as more than one - a single front-facing image is safer.
 *   - One scene per clip; several distinct scenes cannot share one clip.
 *   So ask for "N separate clips, one per scene, up to 8 seconds each". Total length
 *   is the SUM of the clips - it is not something you request.
 *
 * Usage:
 *   node agent_mode.js --check
 *   node agent_mode.js --prompt "Create 3 separate clips, one per scene, using @Mia in every scene, up to 8 seconds each" --model "veo3.1 low priority"
 *   node agent_mode.js --prompt "..." --auto-approve --watch 600
 *
 * Flags:
 *   --cdp N          CDP port (default 9222)
 *   --prompt "..."   the Agent prompt. An "@Name" inside it is SPLIT OUT and
 *                    typed last, because typing it mid-sentence sends the rest
 *                    of the sentence into the picker as a search filter.
 *   --file story.txt the same thing, read from a file. Use this for FULL STORIES:
 *                    they are thousands of characters with line breaks, which
 *                    Windows cannot pass through --prompt without mangling.
 *                    Long prompts are pasted in one shot instead of typed.
 *   --mention Name   characters to reference, comma-separated for several:
 *                    --mention "Mia,Jon,Sara". Overrides any "@" in --prompt.
 *                    Any "@Name" already in --prompt is picked up automatically.
 *                    NOTE: Veo 3.1 accepts at most 3 reference images, so more
 *                    than 3 characters will be refused or silently dropped.
 *   --model "..."    appended as "Use ... for all clips." - Agent Mode takes the
 *                    model as plain English, e.g. --model "veo3.1 low priority".
 *                    This is the only way to reach the lower-priority model,
 *                    which is absent from the ingredients extend menu.
 *   --check          report state only; type and click nothing
 *   --settings       open the Agent settings menu and dump it (the "never ask"
 *                    confirmation toggle lives there), then stop
 *   --no-submit      type the prompt but do not click Start generation
 *   --auto-approve   click approval buttons the agent offers (SPENDS CREDITS)
 *   --paste          paste the prompt as one blob instead of real keystrokes
 *   --watch N        seconds to keep recording after submit (default 240)
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function ts() { return new Date().toTimeString().slice(0, 8); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function banner(msg) { console.log(`\n${'='.repeat(70)}\n${msg}\n${'='.repeat(70)}`); }

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name, def = null) {
    const i = argv.indexOf(name);
    if (i < 0) return def;
    const v = argv[i + 1];
    return (v && !v.startsWith('--')) ? v : true;
}
const CDP_PORT   = flag('--cdp', '9222');
const CDP_URL    = `http://127.0.0.1:${CDP_PORT}`;

// A full story is thousands of characters with line breaks - Windows cannot pass
// that through --prompt "..." without mangling it. --file reads the story from a
// text file instead, which is the only sane way to submit long-form prompts.
const FILE_RAW   = flag('--file');
const FILE_BODY  = (typeof FILE_RAW === 'string')
    ? (fs.existsSync(FILE_RAW)
        ? fs.readFileSync(FILE_RAW, 'utf8').replace(/\r\n/g, '\n').trim()
        : `__MISSING__:${FILE_RAW}`)
    : null;
const PROMPT_RAW = flag('--prompt');
const PROMPT     = (typeof PROMPT_RAW === 'string')
    ? PROMPT_RAW
    : (FILE_BODY && !FILE_BODY.startsWith('__MISSING__') ? FILE_BODY : null);

// The "@" mention MUST be typed last. On the first live run the prompt was typed
// as one string, so everything after "@" - "Mia in every scene" - went into the
// picker as a search FILTER. It matched nothing ("No assets found."), the picker
// stayed open, and the prompt box was left truncated at "using @".
// So: split the mention out, type the plain text, then type "@Name" on its own.
const MENTION_RAW = flag('--mention');
// EVERY mention, not just the first. A scene with two or three characters needs
// one chip per character, and each has to be picked from the picker separately.
const MENTIONS = (typeof MENTION_RAW === 'string')
    ? MENTION_RAW.split(',').map(s => s.replace(/^@/, '').trim()).filter(Boolean)
    : (PROMPT ? [...PROMPT.matchAll(/@([A-Za-z0-9_.\-]+)/g)].map(m => m[1]) : []);

// Model choice in Agent Mode is PLAIN ENGLISH in the prompt - there is no menu.
// Confirmed live 2026-09-11: telling the agent "use veo3.1 low pirority to
// generate all clips" made it schedule every scene on
// "Veo 3.1 - Lite [Lower Priority]" - the very model the ingredients/extend path
// could NOT find in its extend menu (that path failed 12x with "Extend menu
// problem: undefined" because the plan does not offer it there).
const MODEL_RAW = flag('--model');
const MODEL_HINT = (typeof MODEL_RAW === 'string') ? MODEL_RAW : null;

const PROMPT_BASE = PROMPT
    // Keep the NAME as plain words where it belongs, and attach the chip at the
    // end. Dropping it entirely left "using in every scene", which reads badly.
    ? PROMPT.replace(/@([A-Za-z0-9_.\-]+)/g, '$1')
            .replace(/\s{2,}/g, ' ')
            .trim()
    : null;
const PROMPT_TEXT = (PROMPT_BASE && MODEL_HINT)
    ? `${PROMPT_BASE} Use ${MODEL_HINT} for all clips.`
    : PROMPT_BASE;

// A long prompt must NOT be typed key by key - a 3000-character story at 45ms a
// character is 2+ minutes of keystrokes. Paste it in one shot instead. This is
// safe for the mention flow because the mention is typed separately in step 5b.
const LONG_PROMPT = !!(PROMPT_TEXT && PROMPT_TEXT.length > 400);
const CHECK_ONLY = !!flag('--check', false);
const DO_SETTINGS= !!flag('--settings', false);
const NO_SUBMIT  = !!flag('--no-submit', false);
const AUTO_APPROVE = !!flag('--auto-approve', false);
const USE_PASTE  = !!flag('--paste', false);
const WATCH_SECS = parseInt(flag('--watch', '240'), 10);

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RUN_DIR = path.join(__dirname, 'logs', `agent_run_${RUN_ID}`);
let snapN = 0;

// ---- in-page snapshot ------------------------------------------------------
// Everything the caller needs to understand the current screen, collected in
// one round trip. `tail` is the most useful field for a chat surface: it is the
// literal end of the visible text, i.e. whatever the agent just said.
function snapshotFn() {
    const cls = (el) => (el.className && el.className.toString) ? el.className.toString() : '';
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const d = (el, depth) => {
        const r = el.getBoundingClientRect();
        const o = {
            tag: el.tagName.toLowerCase(),
            cls: cls(el).slice(0, 160),
            aria: el.getAttribute('aria-label'),
            role: el.getAttribute('role'),
            text: (el.innerText || el.textContent || '').trim().slice(0, 140),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
        if (depth) o.children = [...el.children].slice(0, 15).map(c => d(c, depth - 1));
        return o;
    };

    const chip = document.querySelector('flow-agent-mode-toggle-chip');
    const gen  = document.querySelector('button[aria-label="Start generation"]');
    const pm   = document.querySelector('flow-base-prompt-box .ProseMirror')
              || document.querySelector('.ProseMirror');

    const buttons = [...document.querySelectorAll('button')]
        .filter(vis)
        .map(b => ({
            aria: b.getAttribute('aria-label'),
            text: (b.innerText || '').trim().slice(0, 60),
            cls: cls(b).slice(0, 120),
            disabled: b.disabled || /mat-mdc-button-disabled/.test(cls(b)),
        }));

    // Chat / agent-reply shaped nodes. Empty until the first prompt is sent.
    const kw = /chat|message|conversation|turn|reply|response|agent-|assistant|storyboard|scene-card|plan/i;
    const chatish = [...document.querySelectorAll('*')]
        .filter(el => kw.test(cls(el)))
        .slice(0, 60)
        .map(el => d(el, 1));

    const mediaTiles = {
        flow_video_tile: document.querySelectorAll('flow-video-tile').length,
        flow_image_tile: document.querySelectorAll('flow-image-tile').length,
        any_tile: [...document.querySelectorAll('*')].filter(el => /tile/i.test(cls(el)) && vis(el)).length,
    };

    const body = (document.body.innerText || '').replace(/\n{3,}/g, '\n\n');

    return {
        url: location.href,
        agentOn: !!(chip && /checked/.test(cls(chip))),
        chipClass: chip ? cls(chip) : null,
        instructionsBtn: !!document.querySelector('button[aria-label="Agent instructions"]'),
        settingsBtn: !!document.querySelector('button[aria-label="Settings"]'),
        promptText: pm ? (pm.innerText || '').slice(0, 1200) : null,
        promptHTML: pm ? (pm.innerHTML || '').slice(0, 3000) : null,
        generateBtn: gen ? {
            exists: true,
            disabled: gen.disabled || /mat-mdc-button-disabled/.test(cls(gen)),
        } : { exists: false },
        overlays: [...document.querySelectorAll('.cdk-overlay-container')]
            .filter(el => el.children.length).map(el => d(el, 2)),
        buttons,
        chatish,
        mediaTiles,
        tail: body.slice(-2000),
    };
}

// ---- deep read of the "@" picker -------------------------------------------
// The first dump only went 2 levels into .cdk-overlay-container and returned a
// pane with no children, so the asset items were invisible to us. This goes all
// the way down and pulls out every clickable thing, so we can find the entry by
// name even when the markup is unfamiliar.
function pickerFn() {
    const cls = (el) => (el.className && el.className.toString) ? el.className.toString() : '';
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const depthOf = (el) => { let d = 0; for (let p = el; p; p = p.parentElement) d++; return d; };

    const root = document.querySelector('.cdk-overlay-container');
    if (!root || !root.children.length) return { open: false };

    const walk = (el, depth, out) => {
        if (depth < 0) return;
        const r = el.getBoundingClientRect();
        out.push({
            tag: el.tagName.toLowerCase(),
            cls: cls(el).slice(0, 140),
            aria: el.getAttribute('aria-label'),
            role: el.getAttribute('role'),
            text: (el.innerText || el.textContent || '').trim().slice(0, 120),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            visible: r.width > 0 && r.height > 0,
            depth,
        });
        for (const c of el.children) walk(c, depth - 1, out);
    };
    const tree = [];
    walk(root, 5, tree);

    const SELECTOR = 'button, [role="option"], [role="menuitem"], mat-option, li, ' +
                     '[class*="asset"], [class*="item"], [class*="card"], [class*="tile"], ' +
                     '[class*="character"], [class*="result"], [class*="thumb"]';
    const clickable = [...root.querySelectorAll(SELECTOR)]
        .filter(vis)
        .map(el => {
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName.toLowerCase(),
                cls: cls(el).slice(0, 140),
                aria: el.getAttribute('aria-label'),
                text: (el.innerText || el.textContent || '').trim().slice(0, 100),
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                depth: depthOf(el),
                cx: Math.round(r.x + r.width / 2),
                cy: Math.round(r.y + r.height / 2),
            };
        })
        .filter(el => el.text || el.aria);

    return {
        open: true,
        paneCount: document.querySelectorAll('.cdk-overlay-pane').length,
        emptyText: /no assets found|no results|nothing found/i.test(root.innerText || ''),
        clickable,
        tree,
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
    log(`Flow tab: ${page.url()}`);

    async function snap(label) {
        const data = await page.evaluate(snapshotFn);
        const f = path.join(RUN_DIR, `${String(++snapN).padStart(2, '0')}_${label}.json`);
        fs.writeFileSync(f, JSON.stringify(data, null, 2));
        return data;
    }

    // ---- 1. Agent Mode must run on the project home, NOT in the editor -----
    const m = page.url().match(/\/project\/([0-9a-f-]+)/i);
    if (!m) {
        console.error(`Cannot find a project id in ${page.url()}`);
        console.error('Open a Flow project (https://flow.google.com/project/...) and retry.');
        await browser.disconnect();
        process.exit(1);
    }
    const projectId = m[1];
    const homeUrl = `https://flow.google.com/project/${projectId}`;

    if (/\/edit\//i.test(page.url()) || /\/scene\//i.test(page.url())) {
        log('Currently in the scene editor. Agent Mode lives on the project home.');
        log(`Navigating back to ${homeUrl}`);
        await page.goto(homeUrl, { waitUntil: 'domcontentloaded' });
        await wait(6000);
    }

    // ---- 2. Settle, then take a baseline -----------------------------------
    await wait(3000);
    let s = await snap('baseline');
    log(`Agent Mode is ${s.agentOn ? 'ON' : 'OFF'}`);
    log(`Prompt box   : ${s.promptText !== null ? 'found' : 'NOT FOUND'}`);
    log(`Submit button: ${s.generateBtn.exists ? (s.generateBtn.disabled ? 'present (disabled)' : 'present (ready)') : 'NOT FOUND'}`);
    log(`Instructions : ${s.instructionsBtn ? 'button present' : 'button not found'}`);
    log(`Media tiles  : video=${s.mediaTiles.flow_video_tile} image=${s.mediaTiles.flow_image_tile}`);

    if (CHECK_ONLY) {
        log(`--check only. Snapshots in ${RUN_DIR}`);
        await browser.disconnect();
        return;
    }

    // ---- 3. Turn the Agent chip ON if needed -------------------------------
    if (!s.agentOn) {
        log('Turning Agent Mode ON...');
        const ok = await page.evaluate(() => {
            const chip = document.querySelector('button.agent-mode-chip')
                      || document.querySelector('flow-agent-mode-toggle-chip button');
            if (!chip) return false;
            chip.click();
            return true;
        });
        if (!ok) { console.error('Agent chip not found - is the prompt box visible?'); await browser.disconnect(); process.exit(1); }
        await wait(2500);
        s = await snap('agent-on');
        log(`Agent Mode now ${s.agentOn ? 'ON' : 'STILL OFF (clicked, but class did not change)'}`);
    }

    // ---- 4. Optional: dump the settings menu -------------------------------
    // The "never ask for confirmation" toggle lives behind this button. We open
    // it only when asked, because it is a real state change.
    if (DO_SETTINGS) {
        log('Opening Agent settings menu...');
        await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')]
                .find(x => /^settings$/i.test(x.getAttribute('aria-label') || '')
                        && /agent-action-button/.test((x.className || '').toString()));
            if (b) b.click();
        });
        await wait(2000);
        const menu = await snap('settings-menu-open');
        log(`Overlay panes now: ${menu.overlays.length}`);
        for (const ov of menu.overlays) {
            for (const c of (ov.children || [])) {
                log(`   ${c.tag}.${(c.cls || '').split(' ')[0]} :: ${(c.text || '').replace(/\n/g, ' | ').slice(0, 120)}`);
            }
        }
        log(`Settings snapshot in ${RUN_DIR}. Close the menu, or keep it open for the next step.`);
        await browser.disconnect();
        return;
    }

    // ---- 5. Type the Agent prompt -----------------------------------------
    if (!PROMPT) {
        if (FILE_BODY && FILE_BODY.startsWith('__MISSING__')) {
            console.error(`--file not found: ${FILE_BODY.slice('__MISSING__:'.length)}`);
        } else {
            console.error('No --prompt and no --file given. Nothing to do.');
            console.error('Short prompt : node agent_mode.js --prompt "Create 3 separate clips, one per scene, using @Mia in every scene, up to 8 seconds each" --model "veo3.1 low priority"');
            console.error('Full story   : node agent_mode.js --file story_prompt.txt --model "veo3.1 low priority" --no-submit');
        }
        await browser.disconnect();
        process.exit(1);
    }

    log('Focusing the prompt box...');
    const box = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                || document.querySelector('.ProseMirror');
        if (!pm) return null;
        pm.scrollIntoView({ block: 'center' });
        const r = pm.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!box) { console.error('Prompt box not found.'); await browser.disconnect(); process.exit(1); }

    await page.mouse.click(box.x, box.y);
    await wait(600);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await wait(200);

    // ---- 5a. Plain prompt text FIRST --------------------------------------
    // No mention in this string - see the MENTION split at the top of the file.
    log(`Prompt body: ${PROMPT_TEXT.length} characters.`);
    if (USE_PASTE || LONG_PROMPT) {
        if (LONG_PROMPT && !USE_PASTE) log('Long prompt - pasting instead of typing (--paste is implied).');
        // One blob, one shot. Newlines are preserved so story structure reaches
        // the agent. This does NOT fire the "@" autocomplete, which is fine: the
        // mention is typed separately in step 5b, after this.
        const inserted = await page.evaluate((t) => {
            const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                    || document.querySelector('.ProseMirror');
            if (!pm) return 'no-editor';
            pm.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, t);
            return (pm.innerText || '').length;
        }, PROMPT_TEXT);
        if (inserted === 'no-editor') { console.error('Prompt box vanished before paste.'); await browser.disconnect(); process.exit(1); }
        log(`Pasted. Editor now holds ~${inserted} characters.`);
    } else {
        // Real keystrokes. Slower, but ProseMirror's input rules see every
        // character, so typing "@Mia" opens the mention picker like a human.
        await page.keyboard.type(PROMPT_TEXT, { delay: 45 });
    }
    await wait(1800);

    s = await snap('prompt-text-typed');
    const got = (s.promptText || '');
    log(`Prompt text now: "${got.slice(0, 110)}${got.length > 110 ? ' ...' : ''}"`);
    log(`Editor reports ${got.length} characters (sent ${PROMPT_TEXT.length}).`);
    // ProseMirror can quietly swallow parts of a multi-line paste. If the counts
    // diverge badly, stop rather than submit a story the agent never received.
    if (Math.abs(got.length - PROMPT_TEXT.length) > Math.max(40, PROMPT_TEXT.length * 0.05)) {
        log('WARNING: the editor holds a different amount of text than was sent.');
        log('         Multi-line paste may have been mangled. Inspect the snapshot');
        log(`         ${RUN_DIR}\\*_prompt-text-typed.json before trusting this run.`);
    }

    // ---- 5b. The mention(s), LAST -----------------------------------------
    if (MENTIONS.length) {
        log(`${MENTIONS.length} mention(s), typed last: ${MENTIONS.map(m => '@' + m).join(' ')}`);
        if (MENTIONS.length > 3) {
            log(`WARNING: ${MENTIONS.length} characters is over the Veo 3.1 ceiling of 3`);
            log(`         reference images. Expect the agent to refuse or silently drop one.`);
        }

        for (let mi = 0; mi < MENTIONS.length; mi++) {
            const name = MENTIONS[mi];
            log(`[${mi + 1}/${MENTIONS.length}] attaching @${name}`);

            // A chip leaves a trailing space, so only the first mention needs one.
            await page.keyboard.type(mi === 0 ? ' @' : '@', { delay: 130 });
            await wait(2000);
            await snap(`mention${mi + 1}-open`);

            // Type ONLY the name, so the picker filters on the name and nothing else.
            await page.keyboard.type(name, { delay: 130 });
            await wait(2600);

            s = await snap(`mention${mi + 1}-filtered`);
            const pk = await page.evaluate(pickerFn);
            fs.writeFileSync(
                path.join(RUN_DIR, `${String(snapN).padStart(2, '0')}_picker${mi + 1}-tree.json`),
                JSON.stringify(pk, null, 2));

            log(`   picker open=${pk.open} panes=${pk.paneCount} clickable=${(pk.clickable || []).length} saysEmpty=${pk.emptyText}`);
            if (mi === 0) {
                for (const c of (pk.clickable || []).slice(0, 20)) {
                    log(`      - ${c.tag} [${(c.cls || '').split(' ')[0]}] "${(c.text || c.aria || '').slice(0, 55)}"`);
                }
            }

            // Pick the tightest, deepest match for the character name. A wrapper
            // container also "contains" the name, so sorting by depth avoids
            // clicking a giant pane that happens to hold the whole grid.
            const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            const hit = (pk.clickable || [])
                .filter(c => re.test(c.text || '') || re.test(c.aria || ''))
                .filter(c => (c.text || c.aria || '').trim().length < 80)
                .sort((a, b) => b.depth - a.depth)[0];

            if (hit) {
                log(`   clicking: ${hit.tag} "${(hit.text || hit.aria || '').slice(0, 50)}" at ${hit.cx},${hit.cy}`);
                await page.mouse.click(hit.cx, hit.cy);
                await wait(2500);
                s = await snap(`mention${mi + 1}-picked`);
                log(`   prompt tail now: "...${(s.promptText || '').slice(-90)}"`);
            } else {
                log(`   NO picker entry matched "${name}" - skipped. Tree saved for inspection.`);
            }
        }

        s = await snap('mentions-final');
        const chips = ((s.promptHTML || '').match(/class="mention-chip"/g) || []).length;
        log(`Mention chips in the prompt: ${chips} (expected ${MENTIONS.length})`);
        if (chips < MENTIONS.length) {
            log('Fewer chips than characters - at least one attachment FAILED. Do not submit blind.');
        }
    } else {
        log('No mention in the prompt - skipping the picker step.');
    }

    s = await snap('prompt-final');
    log(`Final prompt: "${(s.promptText || '').slice(0, 140)}"`);
    log(`Submit button: ${s.generateBtn.exists ? (s.generateBtn.disabled ? 'STILL DISABLED' : 'READY') : 'NOT FOUND'}`);

    if (NO_SUBMIT) {
        log(`--no-submit: stopping here. Snapshots in ${RUN_DIR}`);
        await browser.disconnect();
        return;
    }

    // ---- 6. Submit ---------------------------------------------------------
    // An open mention picker must be dismissed first, or the click lands on it.
    const stillOpen = await page.evaluate(() => {
        const r = document.querySelector('.cdk-overlay-container');
        return !!(r && r.children.length);
    });
    if (stillOpen) {
        log('Picker still open - pressing Escape so the click reaches Generate.');
        await page.keyboard.press('Escape');
        await wait(800);
    }

    log('Clicking Start generation...');
    const clicked = await page.evaluate(() => {
        const b = document.querySelector('button[aria-label="Start generation"]');
        if (!b) return 'missing';
        if (b.disabled || /mat-mdc-button-disabled/.test((b.className || '').toString())) return 'disabled';
        b.click();
        return 'clicked';
    });
    if (clicked !== 'clicked') {
        console.error(`Submit failed: ${clicked}`);
        console.error(`Snapshots in ${RUN_DIR} - check 03_prompt-typed.json (was the prompt accepted?)`);
        await browser.disconnect();
        process.exit(1);
    }
    log('Submitted.');

    // ---- 7. Watch the conversation ----------------------------------------
    // This is where the unknown lives. We poll, snapshot on every visible
    // change, and report approval-looking buttons instead of guessing at them.
    banner(`WATCHING AGENT RESPONSE (${WATCH_SECS}s)`);
    log(AUTO_APPROVE
        ? 'Auto-approve is ON - approval buttons will be clicked automatically.'
        : 'Auto-approve is OFF - if the agent asks for approval, CLICK IT YOURSELF.');
    log('Everything on screen is being recorded, so this run doubles as the probe.');

    const APPROVE = /approve|confirm|proceed|go ahead|looks good|generate|continue|yes\b|create the|start/i;
    const t0 = Date.now();
    let lastTail = '';
    let lastSnap = 0;
    let approvals = 0;
    let sawChat = false;

    while ((Date.now() - t0) / 1000 < WATCH_SECS) {
        await wait(4000);
        const cur = await page.evaluate(snapshotFn);
        const elapsed = Math.round((Date.now() - t0) / 1000);

        if (cur.chatish.length && !sawChat) {
            sawChat = true;
            log(`[${elapsed}s] Agent conversation appeared (${cur.chatish.length} nodes).`);
            await snap('chat-appeared');
        }

        if (cur.tail !== lastTail) {
            lastTail = cur.tail;
            const fresh = cur.tail.split('\n').map(x => x.trim()).filter(Boolean).slice(-4);
            log(`[${elapsed}s] screen changed. Last lines:`);
            for (const line of fresh) log(`        | ${line.slice(0, 130)}`);
        }

        // Periodic full snapshot so long silences still leave a trail.
        if (elapsed - lastSnap >= 30) {
            lastSnap = elapsed;
            await snap(`watch-${elapsed}s`);
            log(`[${elapsed}s] clips: video=${cur.mediaTiles.flow_video_tile} image=${cur.mediaTiles.flow_image_tile}`);
        }

        // Approval buttons the agent has put on screen.
        const cands = cur.buttons.filter(b =>
            b.aria && APPROVE.test(b.aria) && !b.disabled &&
            !/^(Settings|Agent instructions|Start generation|Home|Search|Favorite|Expand)$/i.test(b.aria)
        );
        if (cands.length) {
            log(`[${elapsed}s] APPROVAL OPTIONS: ${cands.map(c => `"${c.aria}"`).join(', ')}`);
            if (AUTO_APPROVE) {
                const label = cands[0].aria;
                const done = await page.evaluate((lbl) => {
                    const b = [...document.querySelectorAll('button')]
                        .find(x => x.getAttribute('aria-label') === lbl);
                    if (!b) return false;
                    b.click();
                    return true;
                }, label);
                if (done) {
                    approvals++;
                    log(`[${elapsed}s] Auto-clicked "${label}" (approval #${approvals}).`);
                    await snap(`approved-${approvals}`);
                    await wait(6000);
                }
            } else {
                log('        auto-approve is OFF - click it in the browser window; recording continues.');
                await snap(`approval-offered-${elapsed}s`);
            }
        }
    }

    // ---- 8. Report ---------------------------------------------------------
    const final = await snap('final');
    banner('AGENT RUN SUMMARY');
    log(`Project      : ${projectId}`);
    log(`Agent Mode   : ${final.agentOn ? 'ON' : 'OFF'}`);
    log(`Clips/images : video=${final.mediaTiles.flow_video_tile} image=${final.mediaTiles.flow_image_tile} any-tile=${final.mediaTiles.any_tile}`);
    log(`Approvals    : ${approvals} auto-clicked`);
    log(`Conversation : ${sawChat ? 'yes' : 'no chat nodes matched'}`);
    log(`Snapshots    : ${snapN} files in ${RUN_DIR}`);
    log('');
    log('Next: tell Claude the run is done. The snapshots show whether the agent');
    log('produced SEPARATE clips (needs ffmpeg concat) or one timeline (needs split).');

    await browser.disconnect();
})().catch(e => { console.error('AGENT RUN FAILED:', e.message); process.exit(1); });
