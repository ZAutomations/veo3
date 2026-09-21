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
 *   - Veo 3.1 accepts AT MOST 3 REFERENCE IMAGES (R2V), so a cast of 2-3 is the
 *     ceiling. Each character contributes ONE image: the reference sheet, which
 *     shows that character from several angles in a single file.
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
 *   --refs <what>    character reference sheets to put in the project before the
 *                    prompt is typed, so "@name" can offer a raw IMAGE tile.
 *                    A story .json (reads character_references), a folder, or a
 *                    comma-separated list of images. THIS IS THE FIX FOR DRIFT:
 *                    an Image tile holds the cast across clips, a saved Flow
 *                    Character does not. See mention_target.js.
 *   --no-upload-refs do not upload; only prefer an Image tile if one is already
 *                    in the project.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
// The "@" picker offers the same character as either a raw Image or a saved
// Flow Character, and that choice - not the prompt text - decides whether the
// cast holds across clips. See mention_target.js for the measurement.
const MT = require('./mention_target.js');
const W  = require('./write_story.js');

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
// A specific project to open before anything else. project_setup.js prints this
// URL, so a batch can give every film its own project instead of trusting
// whichever tab happens to be open.
const PROJECT_URL = typeof flag('--project-url') === 'string' ? flag('--project-url').trim() : '';

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
// Belt-and-braces policy pass: strip wording the video model refuses outright
// before it ever reaches the box. The writer already carries the rule; this
// catches a slip. Long prompts still paste, so the text is otherwise untouched.
const SEND_TEXT = W.sanitizeForPolicy(PROMPT_TEXT);
if (SEND_TEXT !== PROMPT_TEXT) log('Policy sanitizer adjusted the prompt before sending.');

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
// Veo fails a clip now and then (most often "Audio generation failed"). After
// the first watch, click the Retry affordances and watch again - this many
// rounds - so a run does not hand back a film with holes in it. 0 disables.
const RETRY_ROUNDS = Math.max(0, parseInt(flag('--retry-rounds', '6'), 10));
const RETRY_WATCH = parseInt(flag('--retry-watch', '90'), 10);
// Expected clip count, read from the prompt ("Create N separate clips"). Used as
// a gate: a partial film must not be downloaded and joined as if it were whole.
const EXPECTED_CLIPS = (() => {
    const m = String(PROMPT_TEXT || '').match(/create\s+(\d+)\s+separate\s+clips/i);
    return m ? parseInt(m[1], 10) : 0;
})();
// Flow voice asset name(s) to attach via the "+" (Add ingredients) menu.
// Repeatable: --voice Orus --voice Achernar. One for a narrator, two for a
// two-hander so each character gets their own.
const VOICES = (() => {
    const out = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--voice' && argv[i + 1] && !argv[i + 1].startsWith('--')) out.push(String(argv[i + 1]).trim());
    }
    return out.filter(Boolean);
})();

// ---- character reference sheets --------------------------------------------
// A raw Image tile is what keeps the cast stable, and Flow only offers one if
// the sheet is already in the project's asset list. --refs puts them there
// automatically instead of leaving it as a manual upload step per project.
//
//   --refs <story.json>       read character_references out of a story package
//   --refs <dir>              upload every image in a folder
//   --refs a.jpg,b.jpg        upload named files
//   --no-upload-refs          never upload; only prefer Image tiles if present
const REFS_RAW    = flag('--refs');
const UPLOAD_REFS = !flag('--no-upload-refs', false);
const REFS = (() => {
    const out = [];
    if (typeof REFS_RAW !== 'string' || !REFS_RAW.trim()) return out;
    for (const p of REFS_RAW.split(',').map(s => s.trim()).filter(Boolean)) {
        if (!fs.existsSync(p)) { out.push({ name: path.basename(p, path.extname(p)), file: null, asked: p }); continue; }
        if (fs.statSync(p).isDirectory()) {
            for (const f of fs.readdirSync(p)) {
                if (/\.(jpe?g|png|webp)$/i.test(f)) out.push({ name: path.basename(f, path.extname(f)), file: path.join(p, f) });
            }
        } else if (/\.json$/i.test(p)) {
            let story = null;
            try { story = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
                out.push({ name: path.basename(p), file: null, asked: `${p} (unreadable: ${e.message})` });
                continue;
            }
            const storyDir = path.dirname(path.resolve(p));
            const table = story.character_references || {};
            const names = [...new Set([...Object.keys(table),
                                       ...Object.keys(story.character_descriptions || {})])];
            for (const n of names) out.push({ name: n, file: MT.resolveCharacterRef(table, n, storyDir) });
            // The film's one place rides in the same folder and is attached the
            // same way, but it is not a character, so it is not in the table
            // above. Without this the plate never reaches the project and the
            // @Place mention has nothing to bind to.
            const placeName = story.place && String(story.place.name || '').trim();
            if (placeName) out.push({ name: placeName, file: MT.resolveCharacterRef({}, placeName, storyDir) });
        } else if (/\.(jpe?g|png|webp)$/i.test(p)) {
            out.push({ name: path.basename(p, path.extname(p)), file: path.resolve(p) });
        }
    }
    return out;
})();

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

// ---- failure affordances ---------------------------------------------------
// A failed clip surfaces twice. In the agent conversation it is a card with a
// "Retry" button. In the media grid it is a tile that offers only "Reuse
// prompt". This reads both, without clicking anything.
function retryFn() {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    // The specific Veo failure wording, NOT a bare /error/ - that appears in
    // unrelated UI and would make every page look broken.
    const FAIL = /audio generation failed|failed to generate|generation failed|something went wrong|try a different prompt/i;
    const body = document.body.innerText || '';
    const failedText = FAIL.test(body);
    const retryButtons = [...document.querySelectorAll('button')]
        .filter(b => vis(b) && /^retry$/i.test((b.getAttribute('aria-label') || '').trim())).length;
    // A failed media tile renders as an "error tile" holding a Reuse-prompt
    // button. That is the precise anchor: matching a generic ancestor (the
    // virtual-scroll container, a whole section) counts healthy tiles too.
    const reuseInError = [...document.querySelectorAll('[class*=error-tile]')]
        .filter(el => vis(el) && !!el.querySelector('button.reuse-prompt-button, button[aria-label="Reuse prompt"]'))
        .length;
    // A policy refusal reads very differently from a generation failure: the
    // model says it cannot help with that. Count it so the agent can re-ask
    // with a policy-safe wording instead of blindly clicking Retry.
    const refusedText = /policy|violat|community guidelines|not allowed|cannot (generate|create|help)|can't (generate|create|help)|unable to (generate|create)|against our|blocked by|safety/i.test(body);
    return { failedText, retryButtons, reuseInError, refusedText };
}

// Click them. Conversation Retry buttons are safe to click together. A failed
// grid tile offers only "Reuse prompt": clicking it refills the prompt box and
// Start generation resubmits it - so do at most ONE of those per round, since
// the box holds one prompt at a time.
async function clickFailures(page) {
    return await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        let retry = 0, reuse = 0;
        for (const b of [...document.querySelectorAll('button')]) {
            if (vis(b) && /^retry$/i.test((b.getAttribute('aria-label') || '').trim()) && !b.disabled) {
                b.click(); retry++;
            }
        }
        if (!retry) {
            const tile = [...document.querySelectorAll('[class*=error-tile]')].find(vis);
            if (tile) {
                const b = tile.querySelector('button.reuse-prompt-button, button[aria-label="Reuse prompt"]');
                if (b && !b.disabled && vis(b)) { b.click(); reuse++; }
            }
        }
        return { retry, reuse };
    });
}
async function clickStart(page) {
    return await page.evaluate(() => {
        const b = document.querySelector('button[aria-label="Start generation"]');
        if (!b || b.disabled) return false;
        b.click();
        return true;
    });
}

// The playbook gotcha: the agent sometimes says it is "going to generate" but
// never renders an approval card, so the run just sits there. Send it a plain
// confirmation the way a human would.
// A policy refusal cannot be fixed by clicking Retry - the same words will be
// refused again. Re-ask in plain language for a policy-safe version, which is
// also the sanitizer's job on the story side.
async function policyNudge(page) {
    const box = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror') || document.querySelector('.ProseMirror');
        if (!pm) return null;
        pm.focus();
        const r = pm.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    await wait(400);
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    const msg = 'Regenerate only the clips that were refused for policy. Keep every other detail identical, but make the wording policy-safe: do not name or depict any real person, and remove any weeping, sobbing, blood, gore, wounds or weapons aimed at a person. Show only the visual action and keep the narration line.';
    await page.keyboard.type(msg, { delay: 12 });
    await wait(700);
    await page.keyboard.press('Enter');
    return true;
}

async function nudgeAgent(page) {    const box = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror') || document.querySelector('.ProseMirror');
        if (!pm) return null;
        pm.focus();
        const r = pm.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    await wait(400);
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('Yes, generate it now', { delay: 25 });
    await wait(600);
    await page.keyboard.press('Enter');
    return true;
}

// Attach a named voice from Flow's Voices library to the prompt box:
//   "+" (Add ingredients) -> Voices filter -> search the name -> pick the
//   asset-item -> "Add to prompt".
// Without this Veo invents its own narrator and the voice drifts clip to clip.
async function attachVoice(page, name) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        await page.keyboard.press('Escape');
        await wait(700);
        const btnBox = await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')].find((x) => !!x.querySelector('.add-menu-icon'))
                || document.querySelector('button[aria-label="Add ingredients to the prompt box"]');
            if (!b) return null;
            b.scrollIntoView({ block: 'center' });
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        });
        if (!btnBox) { log(`  attempt ${attempt}: no ingredients menu button`); await wait(1200); continue; }
        await page.mouse.click(btnBox.x, btnBox.y);
        await wait(2500);
        const menuOpen = await page.evaluate(() => !!document.querySelector('input[aria-label="Search assets"]'));
        if (!menuOpen) { log(`  attempt ${attempt}: ingredients menu did not open`); await wait(800); continue; }
        await page.evaluate(() => {
            const el = [...document.querySelectorAll('mat-list-item, [role="menuitem"], button, li, span')]
                .find((x) => /^voices$/i.test((x.innerText || '').trim()));
            if (el) el.click();
        });
        await wait(1300);
        const preCount = await page.evaluate(() => document.querySelectorAll('button.asset-item').length);
        log(`  (voice list shows ${preCount} item(s) before search)`);
        const wantedSrc = '\\b' + String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b';
        const findItem = () => page.evaluate((src) => {
            const re = new RegExp(src, 'i');
            const el = [...document.querySelectorAll('button.asset-item')].find((x) => re.test(x.innerText || ''));
            if (!el) return null;
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 42) };
        }, wantedSrc);
        // The voices list is short, so SCAN it first. The search box is fussy
        // about a full name and often says "No assets found" for an item that is
        // plainly in the list, so it is only the fallback.
        let item = await findItem();
        if (!item) {
            const query = String(name).slice(0, Math.max(3, Math.min(String(name).length, 4)));
            const inp = await page.evaluate(() => {
                // The top bar has input.search-input too, so match the aria-label
                // that only the assets picker uses.
                const i = document.querySelector('input[aria-label="Search assets"]')
                    || [...document.querySelectorAll('input')].find((x) => /search assets/i.test(x.getAttribute('placeholder') || ''));
                if (!i) return null;
                const r = i.getBoundingClientRect();
                return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
            });
            if (inp) {
                await page.mouse.click(inp.x, inp.y);
                await wait(300);
                await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                await page.keyboard.type(query, { delay: 60 });
                await wait(2200);
                item = await findItem();
            }
        }
        if (!item) {
            const info = await page.evaluate(() => ({
                items: [...document.querySelectorAll('button.asset-item')].map((x) => (x.innerText || '').replace(/voice_selection/i, '').replace(/\s+/g, ' ').trim()).slice(0, 20),
                searchVal: (document.querySelector('input[aria-label="Search assets"]') || {}).value,
                pane: (document.querySelector('.cdk-overlay-pane') || {}).innerText
                    ? document.querySelector('.cdk-overlay-pane').innerText.replace(/\n/g, ' | ').slice(0, 200) : null,
            }));
            log(`  attempt ${attempt}: no voice matched "${name}" | listed=${JSON.stringify(info.items)} searchVal=${JSON.stringify(info.searchVal)} pane=${JSON.stringify(info.pane)}`);
            await page.keyboard.press('Escape');
            await wait(900);
            continue;
        }
        // A REAL click: a synthetic .click() selects the row but does not arm the
        // detail pane, so the "Add to prompt" button never appears.
        await page.mouse.click(item.x, item.y);
        log(`  selected voice: ${item.text}`);
        await wait(2400);
        const addBtn = await page.evaluate(() => {
            const b = document.querySelector('[class*=detail-add-to]')
                || [...document.querySelectorAll('button')].find((x) => /add to prompt/i.test((x.innerText || '').trim()));
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        });
        let added = false;
        if (addBtn) { await page.mouse.click(addBtn.x, addBtn.y); added = true; }
        await wait(1500);
        await page.keyboard.press('Escape');
        await wait(800);
        log(`  voice "${name}" ${added ? 'added to the prompt' : 'selected, but Add-to-prompt not found'}`);
        if (added) return true;
    }
    log(`  could not attach voice "${name}" after 3 attempts`);
    return false;
}

// A short watch that also auto-approves, used between retry rounds.
async function sweepFor(page, secs, tag) {
    const APPROVE = /approve|confirm|proceed|go ahead|looks good|generate|continue|yes\b|create the|start/i;
    const t0 = Date.now();
    let lastTail = '';
    while ((Date.now() - t0) / 1000 < secs) {
        await wait(4000);
        const cur = await page.evaluate(snapshotFn);
        if (cur.tail !== lastTail) {
            lastTail = cur.tail;
            const fresh = cur.tail.split('\n').map(x => x.trim()).filter(Boolean).slice(-3);
            for (const line of fresh) log(`        | ${line.slice(0, 120)}`);
        }
        if (AUTO_APPROVE) {
            const cands = cur.buttons.filter(b => b.aria && APPROVE.test(b.aria) && !b.disabled &&
                !/^(Settings|Agent instructions|Start generation|Start new session|New session|Home|Search|Favorite|Expand)$/i.test(b.aria));
            if (cands.length) {
                await page.evaluate((lbl) => {
                    const b = [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === lbl);
                    if (b) b.click();
                }, cands[0].aria);
                log(`        auto-clicked "${cands[0].aria}"`);
                await wait(5000);
            }
        }
    }
    // No snapshot here: `snap` lives in the run scope, not at module level, and
    // calling it from here crashed the retry pass with "snap is not defined".
    return await page.evaluate(snapshotFn);
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

// ---- reference-sheet upload -------------------------------------------------
// Flow attaches reference PIXELS only for a raw Image tile. A saved Character is
// a named entity the agent re-instantiates per clip, which is what drifts. So
// the sheet has to be in the project's asset list, and the picker's own
// "Upload media" entry is the way in.
//
// This runs BEFORE the prompt is typed, so the bare "@" it types to open the
// picker can simply be cleared afterwards without disturbing anything.
async function clearPromptBox(page, box) {
    // Ctrl+A is unreliable here: the ProseMirror editor does not reliably hold
    // focus after a mouse click, so a page-level select-all can miss it. Drive
    // the editor's own selection and delete commands instead.
    await page.mouse.click(box.x, box.y);
    await wait(250);
    const left = await page.evaluate(() => {
        const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                || document.querySelector('.ProseMirror');
        if (!pm) return -1;
        pm.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(pm);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
        // Mention chips can survive a text delete; drop them directly.
        for (const chip of pm.querySelectorAll('.mention-chip')) chip.remove();
        pm.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return (pm.innerText || '').trim().length;
    });
    if (left > 0) log(`   warning: prompt box still holds ${left} characters after clearing.`);
    await wait(350);
}

// Is there already a raw Image tile for this name in the project? Re-uploading
// on every run would pile up duplicate assets, so check before uploading.
// Returns the choice if an Image tile is already there, else null.
async function refImageAlreadyPresent(page, box, name) {
    await page.mouse.click(box.x, box.y);
    await wait(350);
    await page.keyboard.type(' @' + name, { delay: 110 });
    await wait(2600);
    const pk = await page.evaluate(pickerFn);
    const choice = MT.chooseMentionTile(pk.clickable || [], name);
    await page.keyboard.press('Escape');
    await wait(400);
    await clearPromptBox(page, box);
    return (choice.reason === 'ok' && choice.kind === 'image') ? choice : null;
}

async function uploadRefThroughPicker(page, box, file) {
    await page.mouse.click(box.x, box.y);
    await wait(400);
    await page.keyboard.type(' @', { delay: 120 });
    await wait(2400);

    // The chooser can only be awaited once we know the click will cause it, so
    // start listening first and give up on the wait rather than hanging.
    const chooserP = page.waitForFileChooser({ timeout: 9000 }).catch(() => null);

    const clicked = await page.evaluate(() => {
        const root = document.querySelector('.cdk-overlay-container');
        if (!root) return false;
        const up = [...root.querySelectorAll('button, [role="menuitem"], a, li')]
            .find(x => /upload media/i.test((x.innerText || '') + ' ' +
                                           (x.getAttribute('aria-label') || '')));
        if (!up) return false;
        up.click();
        return true;
    });

    if (!clicked) {
        log('      no "Upload media" entry in the picker - skipped');
        await page.keyboard.press('Escape');
        await wait(400);
        await clearPromptBox(page, box);
        return false;
    }

    const chooser = await chooserP;
    if (chooser) {
        await chooser.accept([file]);
    } else {
        // Some builds render a hidden <input type=file> instead of a dialog.
        const input = await page.$('input[type="file"]');
        if (!input) {
            log('      no file chooser appeared - skipped');
            await page.keyboard.press('Escape');
            await wait(400);
            await clearPromptBox(page, box);
            return false;
        }
        await input.uploadFile(file);
    }

    // The upload is a round trip; give it room, then close the picker and clear
    // the "@" so the real prompt starts from an empty box.
    await wait(7000);
    await page.keyboard.press('Escape');
    await wait(500);
    await clearPromptBox(page, box);
    return true;
}

(async () => {
    fs.mkdirSync(RUN_DIR, { recursive: true });

    const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
    const pages = await browser.pages();
    // Prefer a tab that is actually IN a project over one sitting on the
    // Flow home page: the browser often carries both, and first-match
    // grabbed whichever loaded first - the home tab - and then failed the
    // project-id check below even though the project was open all along.
    const flowTabs = pages.filter(p => /flow\.google\.com/i.test(p.url() || ''));
    const page = flowTabs.find(p => /\/project\//i.test(p.url() || ''))
              || flowTabs.find(p => /\/edit\/|\/scene\//i.test(p.url() || ''))
              || flowTabs[0];
    if (!page) {
        console.error('No Flow tab found in the AUTOMATION browser. Open a Flow project there.');
        console.error('Open tabs:\n  ' + pages.map(p => p.url()).join('\n  '));
        await browser.disconnect();
        process.exit(1);
    }
    log(`Flow tab: ${page.url()}`);
    if (flowTabs.length > 1) {
        log(`${flowTabs.length} Flow tabs open - using the one inside a project.`);
    }

    async function snap(label) {
        const data = await page.evaluate(snapshotFn);
        const f = path.join(RUN_DIR, `${String(++snapN).padStart(2, '0')}_${label}.json`);
        fs.writeFileSync(f, JSON.stringify(data, null, 2));
        return data;
    }

    // ---- 1. Agent Mode must run on the project home, NOT in the editor -----
    // An explicit project wins: go straight to it, so one film per project is
    // deterministic rather than "wherever the browser was left".
    if (PROJECT_URL && page.url() !== PROJECT_URL) {
        log(`Opening this film's project: ${PROJECT_URL}`);
        await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await wait(5000);
    }
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

    // ---- 4c. Reference sheets in, BEFORE anything is typed ----------------
    // Must happen first: it types a bare "@" to open the picker, and there is
    // nothing in the box yet to disturb. An Image tile cannot be picked if the
    // sheet was never uploaded to this project.
    if (REFS.length) {
        banner('REFERENCE IMAGES');
        log(`${REFS.length} reference image(s) declared.`);
        let ready = 0, missing = 0;
        for (const r of REFS) {
            if (!r.file) {
                missing++;
                log(`   MISSING  ${r.name}: no image found${r.asked ? ' (' + r.asked + ')' : ''}`);
                continue;
            }
            log(`   ${r.name}: ${path.basename(r.file)}`);
            if (!UPLOAD_REFS) { ready++; continue; }

            // Skip the upload when a raw Image tile is already in the project.
            const already = await refImageAlreadyPresent(page, box, r.name);
            if (already) {
                log(`      already an Image tile - not uploading again`);
                ready++;
                continue;
            }

            const okUpload = await uploadRefThroughPicker(page, box, r.file);
            if (okUpload) ready++; else missing++;
        }
        log(`Uploaded/available: ${ready}   Missing: ${missing}`);
        if (missing) {
            log('A missing sheet means the picker can only offer that character as a');
            log('saved Character, which is the kind that drifts. Expect drift for it.');
        }
        if (!UPLOAD_REFS) log('--no-upload-refs: uploads skipped, using tiles already in the project.');
        await wait(1200);
    }

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
        }, SEND_TEXT);
        if (inserted === 'no-editor') { console.error('Prompt box vanished before paste.'); await browser.disconnect(); process.exit(1); }
        log(`Pasted. Editor now holds ~${inserted} characters.`);
    } else {
        // Real keystrokes. Slower, but ProseMirror's input rules see every
        // character, so typing "@Mia" opens the mention picker like a human.
        // Typing is real keystrokes, and Flow's prompt box treats Enter as SEND.
        // Flatten any newline to a space rather than submitting on the first
        // line - the "one paragraph" rule from the playbook. (Long prompts go
        // through the clipboard paste path above, which is already safe.)
        const flat = SEND_TEXT.replace(/\r?\n+/g, ' ');
        if (flat !== SEND_TEXT) log('Flattened newlines to spaces for typing (Enter would submit early).');
        await page.keyboard.type(flat, { delay: 45 });
    }
    await wait(1800);

    s = await snap('prompt-text-typed');
    const got = (s.promptText || '');
    log(`Prompt text now: "${got.slice(0, 110)}${got.length > 110 ? ' ...' : ''}"`);
    log(`Editor reports ${got.length} characters (sent ${SEND_TEXT.length}).`);
    // ProseMirror can quietly swallow parts of a multi-line paste. If the counts
    // diverge badly, stop rather than submit a story the agent never received.
    if (Math.abs(got.length - SEND_TEXT.length) > Math.max(40, SEND_TEXT.length * 0.05)) {
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

            // Which tile? The old rule was "deepest node whose text matches the
            // name", which is blind to the tile's TYPE - and type is the whole
            // story: an Image tile keeps the cast stable, a Character tile does
            // not. chooseMentionTile ranks by type first, depth second.
            const choice = MT.chooseMentionTile(pk.clickable || [], name);
            fs.writeFileSync(
                path.join(RUN_DIR, `${String(snapN).padStart(2, '0')}_mention${mi + 1}-choice.json`),
                JSON.stringify(choice, null, 2));
            log('   ' + MT.describeChoice(choice, name));

            const hit = choice.inner;
            if (hit) {
                log(`   clicking: ${hit.tag} "${(hit.text || hit.aria || '').slice(0, 50)}" at ${hit.cx},${hit.cy}`);
                await page.mouse.click(hit.cx, hit.cy);
                await wait(2500);
                s = await snap(`mention${mi + 1}-picked`);

                // The snapshot's promptHTML is sliced to 3000 chars from the HEAD,
                // and mention chips are appended at the END - so counting chips in
                // it always reads 0 and proves nothing. Ask the live editor.
                const chipsNow = await page.evaluate(() => {
                    const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                            || document.querySelector('.ProseMirror');
                    return pm ? pm.querySelectorAll('.mention-chip').length : -1;
                });
                log(`   chips in the editor now: ${chipsNow} (expected ${mi + 1})`);
                if (chipsNow >= 0 && chipsNow < mi + 1) {
                    log('   the click did NOT attach a chip - the mention is missing from the prompt.');
                }
            } else {
                log(`   NO picker entry matched "${name}" - skipped. Tree saved for inspection.`);
            }
        }

        s = await snap('mentions-final');
        // Ask the live editor, not the snapshot: promptHTML is head-sliced and
        // the chips live at the tail, so a snapshot count is always 0.
        const chips = await page.evaluate(() => {
            const pm = document.querySelector('flow-base-prompt-box .ProseMirror')
                    || document.querySelector('.ProseMirror');
            return pm ? pm.querySelectorAll('.mention-chip').length : -1;
        });
        log(`Mention chips in the prompt: ${chips} (expected ${MENTIONS.length})`);
        if (chips >= 0 && chips < MENTIONS.length) {
            log('Fewer chips than characters - at least one attachment FAILED. Do not submit blind.');
        }
    } else {
        log('No mention in the prompt - skipping the picker step.');
    }

    // ---- 5c. Voice asset(s) ------------------------------------------------
    // One voice for a narrator, two for a two-hander. Attached last so the
    // chips sit alongside the mentions and before the final submit.
    if (VOICES.length) {
        banner(`VOICE (${VOICES.join(', ')})`);
        for (const v of VOICES) await attachVoice(page, v);
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
    let lastTailAt = 0;       // when the agent's text last changed
    let lastNudgeAt = -999;   // when we last sent a nudge
    let nudges = 0;

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
            lastTailAt = elapsed;
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
            !/^(Settings|Agent instructions|Start generation|Start new session|New session|Home|Search|Favorite|Expand)$/i.test(b.aria)
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

        // Playbook gotcha: the agent sometimes says it is going to generate but
        // never renders an approval card, so nothing ever starts. Nudge it.
        const asking = /going to generate|i will generate|i'll generate|about to generate|shall i|would you like me to|ready to generate|once you confirm|please confirm|let me know/i.test(cur.tail || '');
        const stuckFor = elapsed - lastTailAt;
        if (AUTO_APPROVE && !cands.length && asking && stuckFor > 12 && nudges < 4 && (elapsed - lastNudgeAt) > 30) {
            nudges++;
            lastNudgeAt = elapsed;
            if (await nudgeAgent(page)) {
                log(`[${elapsed}s] agent looked stalled - sent "Yes, generate it now" (nudge ${nudges}).`);
                await snap(`nudge-${nudges}`);
                await wait(4000);
            }
        }
    }

    // ---- 7b. Retry failed clips -------------------------------------------
    // Failures are usually transient ("Audio generation failed" is Veo-side).
    // Click the Retry affordances and watch again, a bounded number of rounds,
    // instead of handing back a short film.
    let retried = 0;
    let policyNudges = 0;
    if (RETRY_ROUNDS > 0) {
        banner(`CHECKING CLIPS${EXPECTED_CLIPS > 0 ? ` (expect ${EXPECTED_CLIPS})` : ''} - up to ${RETRY_ROUNDS} retry rounds`);
        for (let round = 1; round <= RETRY_ROUNDS; round++) {
            const cur = await page.evaluate(snapshotFn);
            const have = cur.mediaTiles.flow_video_tile;
            const tally = EXPECTED_CLIPS > 0 ? `${have}/${EXPECTED_CLIPS}` : `video=${have}`;
            // SUCCESS: every clip is on screen. Nothing to retry.
            if (EXPECTED_CLIPS > 0 && have >= EXPECTED_CLIPS) {
                log(`Round ${round}: clips ${tally} [OK] - all clips ready.`);
                break;
            }
            const st = await page.evaluate(retryFn);
            // A policy refusal is not a transient failure: clicking Retry sends
            // the same refused words. Re-ask for a policy-safe version instead.
            if (st.refusedText) {
                policyNudges++;
                log(`Round ${round}: clips ${tally} - POLICY REFUSAL on screen; re-asking with policy-safe wording (${policyNudges}).`);
                if (await policyNudge(page)) {
                    await snap(`policy-nudge-${policyNudges}`);
                    await sweepFor(page, RETRY_WATCH, `policy-nudge-${policyNudges}-after`);
                }
                if (policyNudges >= 2) { log('  policy nudge limit reached - stopping.'); break; }
                continue;
            }
            // Nothing failed and nothing is retryable: the gate downstream decides.
            if (!st.retryButtons && !st.reuseInError) {
                log(`Round ${round}: clips ${tally}, no retry affordance on screen - stopping.`);
                break;
            }
            log(`Round ${round}: clips ${tally} [INCOMPLETE], ${st.retryButtons} Retry button(s), ${st.reuseInError} failed tile(s) - retrying.`);
            const c = await clickFailures(page);
            retried += c.retry + c.reuse;
            if (!c.retry && !c.reuse) { log('  nothing clickable - stopping retries.'); break; }
            log(`  clicked: ${c.retry} Retry, ${c.reuse} Reuse prompt`);
            await wait(2500);
            if (c.reuse) {
                const s = await clickStart(page);
                log(`  Start generation: ${s ? 'clicked' : 'not clickable'}`);
                await wait(2500);
            }
            await snap(`retry-${round}`);
            await sweepFor(page, RETRY_WATCH, `retry-${round}-after`);
        }
        log(`Retry pass done: ${retried} affordance(s) clicked.`);
    }

    // ---- 8. Report ---------------------------------------------------------
    const final = await snap('final');
    banner('AGENT RUN SUMMARY');
    log(`Project      : ${projectId}`);
    log(`Agent Mode   : ${final.agentOn ? 'ON' : 'OFF'}`);
    log(`Clips/images : video=${final.mediaTiles.flow_video_tile} image=${final.mediaTiles.flow_image_tile} any-tile=${final.mediaTiles.any_tile}`);
    log(`Approvals    : ${approvals} auto-clicked`);
    log(`Retries      : ${retried} failed-clip affordance(s) clicked`);
    log(`Conversation : ${sawChat ? 'yes' : 'no chat nodes matched'}`);
    log(`Snapshots    : ${snapN} files in ${RUN_DIR}`);

    // The gate: do not let a partial film be downloaded and joined as if it were
    // whole. Video tiles are the clips (the reference sheets are images).
    let incomplete = false;
    if (EXPECTED_CLIPS > 0) {
        const have = final.mediaTiles.flow_video_tile;
        incomplete = have < EXPECTED_CLIPS;
        log(`Clips ready  : ${have}/${EXPECTED_CLIPS}  [${incomplete ? 'INCOMPLETE' : 'OK'}]`);
        if (incomplete) {
            log('  Not every clip was produced, so download/join is SKIPPED - a partial');
            log('  film would look broken. Re-run to retry it, or raise --retry-rounds.');
        }
    }
    log('');
    log('Next: tell Claude the run is done. The snapshots show whether the agent');
    log('produced SEPARATE clips (needs ffmpeg concat) or one timeline (needs split).');

    await browser.disconnect();
    if (incomplete) process.exit(2);
})().catch(e => { console.error('AGENT RUN FAILED:', e.message); process.exit(1); });
