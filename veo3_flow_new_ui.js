#!/usr/bin/env node
/**
 * VEO3 FLOW NEW-UI ENGINE (flow.google.com "Scenes" UI)
 * ======================================================
 * Port of the battle-tested Veo3 automation logic to Google Flow's new UI.
 *
 * Architecture inherited from the old tool (veo3_ingredients_method_puppeteer.js
 * + veo3_scene_builder_puppeteer.js):
 *   - Class-based engine, verbose timestamped console logs
 *   - 7-strategy generation completion detection + error detection
 *   - Full retry on "Something went wrong" (re-arm + re-prompt + re-generate)
 *   - Failed-prompt log file: stories/<name>/logs/<name>_FAILED.txt
 *   - Pause/Resume with keyboard (P / R), resume from any scene
 *   - Aggressive multi-strategy clicking
 *
 * New-UI flow (all clips live in ONE scene):
 *   Scene 1 : refs + prompt typed into project grid -> user clicks Start
 *             generation -> tool waits for clip -> opens editor
 *   Scene 2+: in editor, "Add clip" -> "Extend (Veo 3.1 - Lite)" -> prompt
 *             -> "Start generation" -> wait for timeline to grow by 8s.
 *             Flow does not accept new image/voice ingredient chips in an
 *             Extend request; continuity comes from the preceding clip.
 *   Final   : "Download scene" export -> ffmpeg split into scene-XX.mp4
 *
 * Usage:
 *   node veo3_flow_new_ui.js <story.json> [--project-url URL] [--from N]
 *        [--to N] [--skip-refs] [--cdp 9222]
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const readline = require('readline');
const remoteConfig = require('./remote_config.js');
const health = require('./page_health.js');
// Which reference images a scene needs (its cast AND the place) and how to tell
// whether they actually attached. See refs_for_scene.js for the measured
// failures this replaced.
const { loadStoryRefs, refsForScene, refAliases, missingRefs, MAX_INGREDIENTS } = require('./refs_for_scene.js');
// The narrator's voice, from the preset the story was written with, and the
// picker walk that puts it on each clip. Veo invents a new narrator per clip
// otherwise, so a film comes back in three different voices. See flow_voice.js.
const { resolveFlowVoice, attachVoice } = require('./flow_voice.js');

// Chrome installs to different folders depending on the installer's bitness
// (and per-user installs land in LOCALAPPDATA). Resolve the real one at
// startup instead of assuming the 64-bit Program Files path.
const CHROME_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];
const CHROME_EXE = CHROME_CANDIDATES.find(p => fs.existsSync(p)) || CHROME_CANDIDATES[0];

const CONFIG = {
    CDP_URL: 'http://127.0.0.1:9222',
    CHROME_EXE,
    CHROME_PROFILE: 'Profile 3',
    HEADLESS: false,
    INITIAL_WAIT: 40000,      // settle time before active checking
    CHECK_INTERVAL: 2500,     // poll interval
    MAX_WAIT: 480000,         // 8 min per generation
    SCENE_SECONDS: 8,
    // Model used for every extend. The menu offers "Extend (Veo 3.1 - Lite)"
    // on this plan - confirmed live by probe_extend.js on 2026-09-22 - and NOT
    // the "[Lower Priority]" suffix this default used to carry, which matched
    // nothing and logged a WARNING on every scene of every run. Matching is a
    // SUBSTRING, so this value also matches a plan that does suffix it. It
    // still falls back to any "Extend (Veo ...)" entry, so a plan change can't
    // stall a run - it just logs which one it actually picked.
    EXTEND_MODEL: 'Veo 3.1 - Lite',
    DOWNLOADS_DIR: path.join(os.homedir(), 'Downloads'),
    OUTPUT_DIR: null,         // set from story dir
};

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ────────────────────────────── logging helpers
let LOG_T0 = Date.now();
function ts() {
    const d = new Date();
    return d.toTimeString().slice(0, 8);
}
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function banner(msg) {
    console.log(`\n${'='.repeat(70)}\n${msg}\n${'='.repeat(70)}`);
}

// ────────────────────────────── sendkeys fallback for native dialogs
function sendKeysToDialog(text) {
    // Activates the Windows "Open" file dialog and types a path + ENTER.
    try {
        const ps = `
$wsh = New-Object -ComObject WScript.Shell
$ok = $wsh.AppActivate('Open')
Start-Sleep -Milliseconds 800
$wsh.SendKeys('${text.replace(/\\/g, '\\\\').replace(/'/g, "''")}')
Start-Sleep -Milliseconds 800
$wsh.SendKeys('{ENTER}')
Write-Output "activated=$ok"`;
        const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 20000 });
        return /activated=True/.test(out);
    } catch (e) {
        log(`   ⚠️  SendKeys fallback failed: ${e.message.slice(0, 100)}`);
        return false;
    }
}

function pressEscapeOnDialog() {
    try {
        const ps = `
$wsh = New-Object -ComObject WScript.Shell
if ($wsh.AppActivate('Open')) {
  Start-Sleep -Milliseconds 500
  $wsh.SendKeys('{ESC}')
  Write-Output 'escaped'
} else { Write-Output 'no dialog' }`;
        const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 15000 });
        return /escaped/.test(out);
    } catch { return false; }
}

// ────────────────────────────── dedicated profile (the "built browser")
// Same approach as the MCP setup: a persistent dedicated profile seeded once
// from the real Chrome profile. Custom --user-data-dir is what makes modern
// Chrome (136+) allow the remote-debugging port at all.
function copyDirResilient(src, dest) {
    const skip = new Set(['Sessions', 'Current Session', 'Current Tabs', 'Last Session', 'Last Tabs', 'Crashpad']);
    if (!fs.existsSync(src)) return;
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        try {
            if (entry.isDirectory()) {
                fs.mkdirSync(d, { recursive: true });
                copyDirResilient(s, d);
            } else {
                fs.copyFileSync(s, d);
            }
        } catch {}
    }
}

function makeCleanProfile(profileDir, profile) {
    // Prevent Chrome from restoring a previous browsing session / tab set
    try {
        const prefsPath = path.join(profileDir, profile, 'Preferences');
        if (fs.existsSync(prefsPath)) {
            const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
            prefs.session = prefs.session || {};
            prefs.session.restore_on_startup = 4;
            prefs.session.startup_urls = [];
            prefs.exit_type = 'Normal';
            prefs.exited_cleanly = true;
            fs.writeFileSync(prefsPath, JSON.stringify(prefs));
        }
    } catch {}
}

function buildDedicatedProfile() {
    const userDataDir = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
    const profile = CONFIG.CHROME_PROFILE;
    const profileSource = path.join(userDataDir, profile);
    const localStateSrc = path.join(userDataDir, 'Local State');
    // Reuse the SAME dedicated browser the MCP setup built (Flow login included).
    const profileDir = path.join(process.env.LOCALAPPDATA, 'flow-mcp-profile');

    if (!fs.existsSync(path.join(profileDir, 'Local State'))) {
        log(`   🌱 Seeding dedicated profile from real "${profile}" (one-time)...`);
        fs.mkdirSync(path.join(profileDir, profile), { recursive: true });
        copyDirResilient(profileSource, path.join(profileDir, profile));
        try { fs.copyFileSync(localStateSrc, path.join(profileDir, 'Local State')); } catch {}
        makeCleanProfile(profileDir, profile);
        log('   ✅ Dedicated profile ready (Flow login included)');
    } else {
        log('   ✅ Using the built automation browser profile (login persisted)');
    }
    return profileDir;
}

// ── where Flow's export actually goes ────────────────────────────────────────
// "Download scene" is an ordinary browser download, so the destination is
// Chrome's decision, not ours. By default that means ~/Downloads - and not a
// file in it. Flow writes a folder named after the project, holding another
// folder, holding ONE FILE PER CLIP:
//
//   ~/Downloads/Untitled Scene 09-23 10_04_54/_root___context___/
//       context___instruction___prompt_Continue_20260923151928.mp4
//       context___instruction___prompt_Continue_20260923151928_2.mp4
//       ...
//       context___instruction___prompt_[SHOT]_20260923151956.mp4
//
// The engine used to watch the TOP LEVEL of ~/Downloads for a single new .mp4,
// so it never saw any of them: the run sat out its full ten minutes and then
// reported "Export never produced an .mp4 in Downloads" while the clips were
// one directory down. That is the "download failed" that was really a download
// nobody could find.
//
// Two things fix it: point the browser at a folder of our own, and then sweep
// RECURSIVELY wherever the files went anyway, in case pointing it did not take.

// Every .mp4 under a folder, however deep. Chrome only renames its temporary
// file to .mp4 once the download is complete, so anything found here is whole.
function mp4sUnder(dir) {
    const out = [];
    const walk = (d) => {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
        for (const e of entries) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!/\.mp4$/i.test(e.name)) continue;
            if (/\.crdownload$/i.test(e.name)) continue;
            try { const st = fs.statSync(p); out.push({ file: p, size: st.size, mtime: st.mtimeMs }); }
            catch (e) { /* vanished mid-scan */ }
        }
    };
    walk(dir);
    return out.sort((a, b) => a.file.localeCompare(b.file));
}

// Flow names an exported clip after the words its prompt OPENS with, stamps it
// with the second it was written, and numbers collisions _2, _3:
//
//   ...prompt_Continue_20260923151928.mp4     stem "…Continue", stamp, seq 1
//   ...prompt_Continue_20260923151928_2.mp4   same stem, same stamp, seq 2
//
// That order is Flow's WRITE order, and it is NOT story order. Measured on a
// real 5-clip export the establishing clip - the only one whose prompt starts
// "[SHOT]" - was stamped 28 seconds AFTER the four extends, because every
// extend's prompt opens "Continue…" and they were written first. Sorting by
// name would have put clip 1 last. So this is used only to enumerate the files
// deterministically; story order comes from order_clips_by_dialogue.js.
function flowClipKey(file) {
    const name = path.basename(file).replace(/\.mp4$/i, '');
    const m = name.match(/_(\d{14})(?:_(\d+))?$/);
    if (!m) return { stem: name, stamp: 0, seq: 1 };
    return { stem: name.slice(0, m.index), stamp: Number(m[1]), seq: m[2] ? Number(m[2]) : 1 };
}
function flowClipOrder(a, b) {
    const ka = flowClipKey(a), kb = flowClipKey(b);
    if (ka.stem === kb.stem) return (ka.stamp - kb.stamp) || (ka.seq - kb.seq);
    return (ka.stamp - kb.stamp) || a.localeCompare(b);
}

// ────────────────────────────── engine
class Veo3FlowNewUI {
    constructor(jsonFilePath, opts = {}) {
        this.jsonFilePath = path.resolve(jsonFilePath);
        this.opts = opts;
        this.browser = null;
        this.page = null;
        this.scenes = [];
        this.story = null;
        this.characterReferences = {};
        // Every ref the story declares, cast AND place, read from its refs.json
        // (or sheets file) rather than from character_references - which has no
        // place in it, and is how the room went missing from every clip.
        this.storyRefs = [];
        this.storyRefsSource = '';
        this.projectUrl = opts.projectUrl || '';
        this.fromScene = opts.fromScene || 1;
        this.toScene = opts.toScene || 0; // 0 = all
        // A normal range resume belongs to the timeline already in Flow. Ignore
        // stale phase-1 flags even when a caller other than the GUI supplies
        // them. `--fresh-project` remains the explicit exception used when an
        // account rotation must continue in a different account's new project.
        this.resumeExisting = this.fromScene > 1 && !opts.freshProject;
        this.resumeIgnoredNewProject = this.resumeExisting && !!opts.newProject;
        this.resumeIgnoredGenRefs = this.resumeExisting && !!opts.genRefs;
        if (this.resumeExisting) {
            opts.newProject = false;
            opts.genRefs = false;
        }
        this.skipRefs = !!opts.skipRefs;
        // A voice reference can be attached to the initial Ingredients clip.
        // Flow rejects ingredient chips inside Extend, so subsequent clips
        // inherit continuity from the preceding video instead.
        this.noVoice = !!opts.noVoice;
        this.flowVoice = null;
        // Attach the sheets to clip 1 too. Clip 1 is where the faces are set for
        // the whole film, so the sheets matter there most - but it is a step the
        // user drives by hand (they pick the model and press Start generation),
        // so it is opt-in rather than a change to a working flow.
        this.refsOnClip1 = !!opts.refsOnClip1;
        // Make the reference images inside the project before generating, on the
        // page this run already has open - the step that used to be done by
        // hand. Same routine Agent Mode uses, so both routes build the same
        // tiles and neither needs files in character_refs/.
        this.genRefs = !!opts.genRefs;
        this.cdpUrl = opts.cdp || CONFIG.CDP_URL;
        // Multi-account credit pool (account_manager.js): when set, the
        // engine runs on that account's own Chrome profile and counts its
        // clips. freshProject starts a NEW project on the grid - used when
        // a story continues under the next account (projects are
        // per-account, so the old project cannot be extended there).
        this.accountLabel = opts.account || '';
        this.freshProject = !!(opts.freshProject || opts.newProject);
        this._editorSeen = false;
        // Flow requires Veo 3.1 Lite for Extend. The first Ingredients clip may
        // use Lite or Fast, but that choice must not leak into this setting.
        this.extendModel = opts.extendModel || CONFIG.EXTEND_MODEL;
        this.okScenes = []; // scene numbers that exist on the timeline
        this.sequenceSuspect = false; // set when a clip may have landed out of order

        const jsonDir = path.dirname(this.jsonFilePath);
        const jsonName = path.basename(this.jsonFilePath, '.json');
        this.storyDir = jsonDir;
        this.outputDir = path.join(jsonDir, 'output');
        // Where the browser is told to put the export, so the destination is
        // ours and findable rather than Chrome's default somewhere in
        // ~/Downloads. See mp4sUnder() for why leaving it to Chrome failed.
        this.downloadDir = path.join(jsonDir, 'downloads');
        const logsDir = path.join(jsonDir, 'logs');
        this.failedPromptsLogPath = path.join(logsDir, `${jsonName}_FAILED.txt`);

        // pause/resume
        this.isPaused = false;
        this.setupPauseListener();

        // Flow DOM + timings, from remote_config.js. Every selector the
        // engine matches on comes from here, so a Flow redeploy is a
        // selectors.json edit rather than a code change. The timing values
        // are copied onto CONFIG so the existing call sites keep working.
        this.cfg = remoteConfig.load();
        this.sel = this.cfg.selectors;
        this.pat = remoteConfig.compilePatterns(this.cfg);
        Object.assign(CONFIG, this.cfg.timings);

        // Stall tracking for the generation watchdog: when the last time we
        // saw forward movement, and what that movement looked like.
        this._lastMoveAt = Date.now();
        this._lastPct = -1;
        this._lastEmittedPct = -1;
        this._heals = 0;
    }

    // -- page health -----------------------------------------------------
    // Chrome freezes or discards background tabs to save memory, which stops
    // the page's own timers - a run then sits at "Generating..." forever with
    // nothing actually happening. These four calls keep the tab alive and
    // make the page believe it is focused and on screen.
    async hardenPage() {
        try {
            const client = await this.page.target().createCDPSession();
            // Un-minimise: a minimised window throttles every tab in it.
            try {
                const { windowId } = await client.send('Browser.getWindowForTarget');
                await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
            } catch {}
            // Tell Chrome this tab is in active use so Memory Saver leaves it alone.
            try { await client.send('Page.setWebLifecycleState', { state: 'active' }); } catch {}
            // document.hasFocus() === true, so Flow does not pause its own pollers.
            try { await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch {}
            await client.detach().catch(() => {});
        } catch (e) {
            log(`   (page hardening skipped: ${e.message.slice(0, 60)})`);
        }
    }

    // Close whatever is blocking the page and say what it was. Called when a
    // generation has gone quiet for too long: the usual cause is a dialog
    // that swallowed the click and is now covering the editor.
    async healStalled(reason, force = false) {
        const r = await health.sweep(this.page);
        const did = r.dismissed.length > 0;
        if (did || force) {
            this._heals++;
            log(`   HEAL (${reason}): dismissed ${did ? r.dismissed.join(', ') : 'nothing'}`
                + `${r.errorText ? ` | page said: ${r.errorText}` : ''}`);
        }
        // A dialog we could not click is often one the DOM cannot reach;
        // Escape is the second resort and is harmless when nothing is open.
        if (!did && force && r.overlays > 0) {
            try { pressEscapeOnDialog(); } catch {}
        }
        if (did || r.overlays > 0) this._lastMoveAt = Date.now();
        return r;
    }

    // Progress for the console's bar. Flow exposes a real percentage in some
    // views and nothing in others, so the caller passes an elapsed-time
    // estimate and we prefer the real number when there is one.
    //
    // Only a REAL number counts as forward movement. An estimate rises with
    // the clock whether or not anything is happening, so letting it reset the
    // watchdog would make the watchdog useless - it would never fire on the
    // exact failure it exists to catch.
    async reportProgress(sceneNum, estimatePct, label) {
        const r = await this.evalJs(health.READ_PROGRESS);
        const real = (r && !r.__error && typeof r.pct === 'number') ? r.pct : null;
        if (real !== null && real > this._lastPct) {
            this._lastPct = real;
            this._lastMoveAt = Date.now();
        }
        const pct = real !== null ? real : Math.max(0, Math.min(99, Math.round(estimatePct)));
        if (pct !== this._lastEmittedPct) {
            this._lastEmittedPct = pct;
            log(`[PROGRESS] pct=${pct} scene=${sceneNum} ${label || ''}`.trim());
        }
        return pct;
    }

    // The generation state both poll loops need, in one round trip.
    async readState() {
        const st = await this.evalJs(health.READ_STATE, this.cfg.patterns);
        return (st && !st.__error) ? st : null;
    }

    // Wait for the Flow app shell to actually mount after a navigation,
    // instead of sleeping a fixed 8s and hoping. Returns false on timeout
    // rather than throwing - callers treat the shell as best-effort.
    async waitForFlowShell(maxWaitMs = CONFIG.shellReadyMs) {
        const deadline = Date.now() + maxWaitMs;
        while (Date.now() < deadline) {
            const st = await this.evalJs(() => {
                const t = (document.body && document.body.innerText) || '';
                return {
                    shell: !!document.querySelector('flow-app, app-root, .flow-app, [class*=project-grid]')
                        || /new project|your projects|create/i.test(t),
                    hasApp: !!document.querySelector('app-root, flow-root'),
                };
            });
            if (st && !st.__error && (st.shell || st.hasApp)) return true;
            await wait(1500);
        }
        log('   (Flow shell did not confirm inside the wait window - continuing)');
        return false;
    }

    setupPauseListener() {
        if (process.stdin.isTTY) {
            try { process.stdin.setRawMode(true); } catch {}
        }
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (key) => {
            if (key === '\u0003') { log('🛑 Ctrl+C - exiting...'); process.exit(); }
            const k = key.toLowerCase().trim();
            if ((k === 'p' || k === 'r')) {
                this.isPaused = !this.isPaused;
                log(this.isPaused ? '⏸️  PAUSED - press P or R to resume...' : '▶️  RESUMED');
            }
        });
        log('💡 TIP: press P to pause/resume, Ctrl+C to exit');
    }

    async checkPause() {
        while (this.isPaused) await wait(500);
    }

    async waitForUserInput(message) {
        if (this.opts.autoStart) throw Error('Batch needs attention: ' + message);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise(res => rl.question(message, a => { rl.close(); res(a.trim()); }));
    }

    // ── story loading ─────────────────────────────────────────────
    async loadScenes() {
        const savedCouple = require('./saved_couple').loadSavedCouple('ingredients');
        require('./saved_couple').bindSavedStory(this.jsonFilePath, savedCouple);
        require('./saved_couple').applyIngredientsReferenceMode(this, savedCouple);
        if (savedCouple && !this.resumeExisting && !this.opts.exportOnly) {
            log('Saved couple workflow ON: upload Sarah + George, generate the location, then attach all references to clip 1. Legacy reference flags are overridden.');
        }
        log(`📂 Loading scenes: ${this.jsonFilePath}`);
        const data = JSON.parse(await fsp.readFile(this.jsonFilePath, 'utf-8'));
        if (!data.scenes || !Array.isArray(data.scenes)) {
            throw new Error('Invalid JSON - missing "scenes" array');
        }
        this.scenes = data.scenes;
        this.story = data;
        this.characterReferences = data.character_references || data.characterReferences || {};
        // Scenes 2+ are made by arming Extend, which carries the previous clip's
        // last frame forward. The prompt typed there should say what happens
        // NEXT; a story written for standalone clips says what the scene IS
        // instead, and is re-read as a fresh shot brief - which is how an extend
        // chain comes back looking like cuts. extend_prompts.js derives the
        // continuation prompts and leaves them beside the story; if they are
        // there, the extends use them. No file, no change in behaviour.
        this.extendPrompts = {};
        let extendPromptFile = null;
        const extendPromptsPath = path.join(path.dirname(this.jsonFilePath), 'extend_prompts.json');
        if (fs.existsSync(extendPromptsPath)) {
            try {
                const ep = JSON.parse(fs.readFileSync(extendPromptsPath, 'utf8'));
                extendPromptFile = ep;
                this.extendPrompts = (ep && ep.prompts) || {};
                log(`   ✍️  extend_prompts.json: ${Object.keys(this.extendPrompts).length} continuation prompt(s)`);
            } catch (e) {
                log(`   ⚠️  extend_prompts.json unreadable (${e.message}) - rebuilding it from the story`);
            }
        }
        // Never silently feed standalone scene briefs into the Extend box.
        // Those briefs restage the room and cast on every clip, which is a
        // strong instruction to redesign the people. Derive continuation-only
        // prompts automatically and preserve any hand-written entries already
        // present in the file.
        try {
            const { deriveExtendPrompts } = require('./extend_prompts.js');
            const derived = deriveExtendPrompts(data, data.scenes.length);
            if (derived.ok) {
                let added = 0;
                for (const [num, prompt] of Object.entries(derived.prompts)) {
                    if (!this.extendPrompts[num]) {
                        this.extendPrompts[num] = prompt;
                        added++;
                    }
                }
                if (added || !extendPromptFile) {
                    fs.writeFileSync(extendPromptsPath, JSON.stringify({
                        note: 'Continuation-only prompts for Flow Extend. Returning character identity, wardrobe and environment are locked to the preceding clip. Hand-written entries are preserved.',
                        derivedFrom: path.basename(this.jsonFilePath),
                        droppedBlock: derived.block,
                        prompts: this.extendPrompts,
                    }, null, 2));
                    log(`   ✍️  auto-built ${added} missing continuation prompt(s); saved extend_prompts.json`);
                }
            } else {
                log(`   ⚠️  could not derive continuation prompts (${derived.reason})`);
            }
        } catch (e) {
            log(`   ⚠️  continuation prompt derivation failed (${e.message})`);
        }
        if (!this.projectUrl && data.project_url) this.projectUrl = data.project_url;
        if (!this.toScene || this.toScene > this.scenes.length) this.toScene = this.scenes.length;
        // The refs, from the story's refs.json where it has one. Read here so a
        // missing place or an unmatched name is visible in the log BEFORE a
        // single credit is spent, not discovered in the finished clips.
        const storyRefs = loadStoryRefs(this.jsonFilePath, data);
        this.storyRefs = storyRefs.refs;
        this.storyRefsSource = storyRefs.source;
        log(`   🧩 ${this.storyRefs.length} reference image(s) from ${storyRefs.source}`);
        for (const r of this.storyRefs) log(`      ${r.kind === 'place' ? 'place' : 'cast '}  ${r.name}`);
        if (this.storyRefs.length > MAX_INGREDIENTS) {
            log(`   ⚠️  ${this.storyRefs.length} refs but the video model takes at most ${MAX_INGREDIENTS}`);
        }
        log(`✅ ${this.scenes.length} scenes loaded | range ${this.fromScene}-${this.toScene} | skipRefs=${this.skipRefs}`);
        // Resolved here, before a credit is spent, so the voice the film will be
        // narrated in is visible in the log from the first second. Veo invents
        // its own narrator per clip when the prompt box names none, and a film
        // came back with three different voices because nothing ever named one.
        this.flowVoice = this.noVoice ? null : resolveFlowVoice(data);
        if (this.noVoice) log('   🔊 voice: off (--no-voice)');
        else if (this.flowVoice) log(`   🔊 voice: ${this.flowVoice.name} (from ${this.flowVoice.source}) - attached to every clip`);
        else log('   🔊 voice: none - the preset names no flow_voice, so Veo will pick its own');
        for (const [name, p] of Object.entries(this.characterReferences)) {
            log(`   🧑 ${name}: ${p}`);
        }
    }

    resolveRefPath(refPath, name) {
        const jsonDir = path.dirname(this.jsonFilePath);
        let p = path.resolve(jsonDir, refPath);
        if (fs.existsSync(p)) return p;
        for (const ext of ['.jpg', '.jpeg', '.png']) {
            const t = p.replace(/\.(jpg|jpeg|png)$/i, ext);
            if (fs.existsSync(t)) return t;
        }
        // The story JSON records refs as "<key>_reference_sheet.jpg", but sheets
        // are usually saved with the character's own name ("TARA.jpg"). Without
        // this fallback every ref resolved to null and was silently skipped.
        const key = String(name || '').trim().toLowerCase();
        if (!key) return null;
        const dir = path.join(jsonDir, 'character_refs');
        let entries = [];
        try { entries = fs.readdirSync(dir); } catch { return null; }
        const exts = ['.jpg', '.jpeg', '.png', '.webp'];
        for (const pass of [0, 1]) {
            for (const f of entries) {
                const e = path.extname(f).toLowerCase();
                if (!exts.includes(e)) continue;
                const base = path.basename(f, path.extname(f)).toLowerCase();
                if (pass === 0 && base !== key) continue;
                if (pass === 1 && !base.startsWith(key)) continue;
                return path.join(dir, f);
            }
        }
        return null;
    }

    // The reference images THIS scene needs: its own cast, plus the place it
    // happens in. Delegated so the decision can be tested without a browser -
    // see refs_for_scene.js and test_refs_for_scene.js.
    refsFor(scene) {
        const r = refsForScene(scene, this.storyRefs, this.characterReferences);
        if (r.missingCast.length) {
            log(`   (no reference image declared for: ${r.missingCast.join(', ')})`);
        }
        if (r.overCap) {
            log(`   ${r.refs.length} refs for this scene, over the model's ${MAX_INGREDIENTS} - some may be ignored`);
        }
        return r.refs;
    }

    // What is actually in the prompt box right now: its plain text (an attached
    // ingredient shows there as an @mention) and the text of any ingredient
    // chips (some builds render a mention as an element with no @ in it).
    // Read back rather than assumed - see refs_for_scene.js.
    async readPromptBox() {
        const r = await this.evalJs(() => {
            const box = document.querySelector('.ProseMirror[contenteditable="true"]')
                || [...document.querySelectorAll('[contenteditable="true"]')].pop();
            if (!box) return { text: '', chips: [] };
            const chips = [...box.querySelectorAll('[class*=mention], [class*=chip], [class*=ingredient], [data-mention]')]
                .map(el => (el.innerText || el.textContent || '').trim())
                .filter(Boolean);
            return { text: (box.innerText || box.textContent || ''), chips };
        });
        if (!r || r.__error || typeof r !== 'object') return { text: '', chips: [] };
        return { text: r.text || '', chips: r.chips || [] };
    }

    async ingredientChipState() {
        const r = await this.evalJs(() => {
            const boxes = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')];
            const box = boxes.find(b => b.getBoundingClientRect().width > 0) || boxes[0];
            const scope = box?.closest('flow-base-prompt-box, .base-prompt-box')
                || box?.closest('flow-edit-video-prompt-box, flow-prompt-box') || box;
            const chips = scope ? [...scope.querySelectorAll('button[aria-label="Ingredient"]')] : [];
            return {
                count: chips.length,
                disabled: chips.filter(c => c.classList.contains('chip-container-disabled') ||
                    !!c.querySelector('.disabled-error-icon')).length,
                sources: chips.map(c => c.querySelector('img')?.getAttribute('src') || ''),
            };
        });
        return r && !r.__error ? r : { count: 0, disabled: 0, sources: [] };
    }

    async removeIngredientChipsFromExtend() {
        const removed = await this.evalJs(() => {
            const boxes = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')];
            const box = boxes.find(b => b.getBoundingClientRect().width > 0) || boxes[0];
            const scope = box?.closest('flow-base-prompt-box, .base-prompt-box')
                || box?.closest('flow-edit-video-prompt-box, flow-prompt-box') || box;
            const chips = scope ? [...scope.querySelectorAll('button[aria-label="Ingredient"]')] : [];
            let count = 0;
            for (const chip of chips) {
                const remove = chip.querySelector('button[aria-label*="Remove" i], button[aria-label*="Delete" i], button[aria-label*="Cancel" i], .cancel, mat-icon');
                if (remove && /cancel|close|remove|delete/i.test(
                    `${remove.getAttribute?.('aria-label') || ''} ${remove.textContent || ''} ${remove.className || ''}`)) {
                    remove.click();
                    count++;
                    continue;
                }
                // In the current Flow build the chip itself removes an invalid
                // ingredient when its error/cancel affordance is clicked.
                if (chip.classList.contains('chip-container-disabled') || chip.querySelector('.disabled-error-icon')) {
                    chip.click();
                    count++;
                }
            }
            return count;
        });
        if (Number(removed) > 0) {
            await wait(500);
            log(`   🧹 Removed ${removed} unsupported ingredient chip(s) left in the Extend prompt`);
        }
        const state = await this.ingredientChipState();
        if (state.count) {
            throw new Error(`Extend prompt still contains ${state.count} image/voice ingredient chip(s); Flow does not support them`);
        }
    }

    buildIdentityLockedExtendPrompt(scene, prompt) {
        const directed = require('./dialogue_shot_plan').shotPlan(this.story, scene, { extend: true });
        if (directed) return 'STRICT CONTINUITY: preserve the preceding clip\'s character identities and setting.\n' + directed.prompt;
        const required = this.refsFor(scene);
        const names = required
            .filter(r => r.kind !== 'place')
            .map(r => r.name)
            .filter(Boolean);
        const named = names.length
            ? ` Returning characters (${names.join(', ')}) must match their established appearance exactly.`
            : '';
        const lock = 'STRICT CONTINUITY: continue from the exact previous final frame.' + named
            + ' Keep the same facial identity, age, skin tone, body, hairstyle, wardrobe and accessories. '
            + 'Do not recast, redesign, replace, duplicate or introduce a different version of any returning character. '
            + 'Keep the established location, furniture, palette and lighting consistent.';
        let text = require('./dialogue_speakers').withDialogueAudio(this.story, scene, prompt).trim();
        if (this.story?.narration_scope === 'dialogue' && !text.includes('AUDIO MIX:')) text += '\n' + require('./dialogue_speakers').audioMix();
        text = require('./location_style').withBrightLocation(this.story, text);
        text = require('./ingredients_camera').ingredientsCameraPrompt(this.story, scene, text);
        return /^STRICT CONTINUITY:/i.test(text) ? text : `${lock}\n${text}`;
    }

    async initializeFailedPromptsLog() {
        try {
            fs.mkdirSync(path.dirname(this.failedPromptsLogPath), { recursive: true });
            if (!fs.existsSync(this.failedPromptsLogPath)) {
                await fsp.writeFile(this.failedPromptsLogPath,
                    `# Failed prompts log - ${new Date().toISOString()}\n# Story: ${this.jsonFilePath}\n\n`);
            }
        } catch {}
    }

    async logFailedPrompt(sceneNumber, errorMessage, prompt, retryCount = 0) {
        try {
            const entry = `\n[${new Date().toISOString()}] SCENE ${sceneNumber} (retry ${retryCount})\nERROR: ${errorMessage}\nPROMPT:\n${prompt}\n${'-'.repeat(60)}\n`;
            await fsp.appendFile(this.failedPromptsLogPath, entry);
            log(`   📝 Logged to ${path.basename(this.failedPromptsLogPath)}`);
        } catch {}
    }

    // ── browser connection ────────────────────────────────────────
    // Uses the dedicated "built" browser: system Chrome binary + persistent
    // cloned profile (flow login included) + CDP port. Same as the MCP setup.
    async connect() {
        banner('🚀 CONNECTING THE AUTOMATION BROWSER');
        const port = this.cdpUrl.replace('http://127.0.0.1:', '');
        let connected = false;
        for (let i = 0; i < 3; i++) {
            try {
                this.browser = await puppeteer.connect({ browserURL: this.cdpUrl, defaultViewport: null });
                connected = true;
                break;
            } catch {
                log(`⚠️  No automation Chrome on CDP port ${port} (attempt ${i + 1}/3)`);
                if (i === 0) {
                    // --account runs on that account's own profile (a
                    // different Google login); without it, the legacy
                    // single profile. Account profiles are signed in once
                    // by hand via the GUI's Accounts tab.
                    let profileDir, profileName;
                    if (this.accountLabel) {
                        const am = require('./account_manager.js');
                        const acc = am.findAccount(am.load(), this.accountLabel);
                        if (!acc) throw new Error(`--account "${this.accountLabel}" is not in accounts.json`);
                        profileDir = am.profileDir(acc);
                        profileName = 'Default';
                    } else {
                        profileDir = buildDedicatedProfile();
                        profileName = CONFIG.CHROME_PROFILE;
                    }
                    const a = await this.waitForUserInput('   Launch it now? (y/n): ');
                    if (a.toLowerCase() !== 'y') break;
                    log('   ⏳ Starting Chrome with the dedicated profile...');
                    spawn(CONFIG.CHROME_EXE, [
                        `--remote-debugging-port=${port}`,
                        `--user-data-dir=${profileDir}`,
                        `--profile-directory=${profileName}`,
                        '--no-first-run',
                        '--no-default-browser-check',
                        '--disable-blink-features=AutomationControlled',
                        '--window-size=1920,1080',
                    ], { detached: true, stdio: 'ignore' }).unref();
                }
                await wait(5000);
            }
        }
        if (!connected) throw new Error(`Could not connect to Chrome via CDP ${this.cdpUrl}`);
        log(`✅ Automation browser attached (CDP ${this.cdpUrl}, profile: ${this.accountLabel || CONFIG.CHROME_PROFILE})`);

        const pages = await this.browser.pages();
        // Prefer a tab already inside a project/editor over one sitting on
        // the Flow home page - the browser often carries both.
        const flowPages = pages.filter(p => /flow\.google\.com/i.test(p.url() || ''));
        this.page = flowPages.find(p => /\/project\//i.test(p.url() || ''))
                 || flowPages[0]
                 || pages[pages.length - 1]
                 || await this.browser.newPage();
        this.page.setDefaultTimeout(120000);
        this.page.setDefaultNavigationTimeout(120000);
        await this.hardenPage();
        log(`✅ Page: ${this.page.url().slice(0, 90)}`);
    }

    async gotoProject() {
        // A story continuing under a new account starts a NEW project on
        // the grid - the previous project belongs to that account's login
        // and cannot be opened or extended from here.
        if (this.freshProject && !this._projectPrepared) {
            log('Fresh project: starting on the Flow project grid');
            await this.page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 120000 });
            await this.waitForFlowShell();
            return;
        }
        if (!this.projectUrl) {
            const a = await this.waitForUserInput('🌐 Enter the Flow PROJECT url (https://flow.google.com/project/...): ');
            this.projectUrl = a;
        }
        this.projectUrl = require('./flow_project').normalizeProjectUrl(this.projectUrl);
        log(`🌐 Opening project: ${this.projectUrl}`);
        await this.page.goto(this.projectUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await this.waitForFlowShell();
    }

    isEditorUrl(url) {
        return /\/project\/[a-zA-Z0-9_-]+\/(scene|edit|tool)\//i.test(url || '');
    }

    // ── generic page helpers ──────────────────────────────────────
    async evalJs(fn, ...args) {
        try { return await this.page.evaluate(fn, ...args); }
        catch (e) { return { __error: e.message.slice(0, 150) }; }
    }

    // Read timeline duration from readouts like "00:08:00" (MM:SS:FF) or
    // "00:00:08:00" (HH:MM:SS:FF). Returns the max in SECONDS.
    async getTimelineSeconds() {
        const r = await this.evalJs((readoutSel) => {
            // Preferred: the timeline's TOTAL duration readout (MM:SS:FF).
            // The playhead's own .timecode-value is always smaller, so this is
            // unambiguous where the old max-scan-over-all-readouts was not.
            const dur = document.querySelector(readoutSel);
            if (dur) {
                const g = (dur.textContent || '').trim().split(':').map(Number);
                if (g.length === 3 && g.every(n => !isNaN(n))) return g[0] * 60 + g[1];
            }
            // Fallback: highest MM:SS:FF-shaped string anywhere on the page.
            const out = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const t = walker.currentNode.textContent.trim();
                if (/^00:\d{2}(:\d{2}){1,2}$/.test(t)) out.push(t);
            }
            return out;
        }, this.sel.durationReadoutSelector);
        if (typeof r === 'number') return r;
        if (!Array.isArray(r) || !r.length) return 0;
        let max = 0;
        for (const t of r) {
            const g = t.split(':').map(Number);
            let secs = 0;
            if (g.length === 3) secs = g[0] * 60 + g[1];          // MM:SS:FF
            else if (g.length === 4) secs = g[0] * 3600 + g[1] * 60 + g[2]; // HH:MM:SS:FF
            max = Math.max(max, secs);
        }
        return max;
    }

    async readoutText() {
        const r = await this.evalJs(() => {
            const out = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const t = walker.currentNode.textContent.trim();
                if (/^00:\d{2}:\d{2}$/.test(t)) out.push(t);
            }
            return out;
        });
        return Array.isArray(r) ? r.join(' ') : '';
    }

    // ── prompt typing (ProseMirror editor in new UI) ─────────────
    async typePrompt(prompt) {
        const ok = await this.evalJs((p) => {
            // The prompt box is a ProseMirror editor; its placeholder span reads
            // "What happens next?" / "What do you want to create?" / "Describe how to editâ€¦"
            const visible = e => {
                const r = e.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            };
            let el = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')].find(visible);
            if (!el) {
                const boxes = [...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
                el = boxes.find(e => /What do you want to create|What happens next|Describe how to edit/.test(e.innerText || ''))
                     || boxes[boxes.length - 1];
            }
            if (!el) return false;
            el.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            selection.removeAllRanges();
            selection.addRange(range);
            const inserted = document.execCommand('insertText', false, p);
            el.dispatchEvent(new InputEvent('input', {
                bubbles: true, inputType: 'insertText', data: p,
            }));
            return inserted || (el.innerText || el.textContent || '').trim().length > 0;
        }, prompt);
        if (!ok) throw new Error('prompt box not found');
        await wait(500);
        const readBack = await this.evalJs(() => {
            const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            const el = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')].find(visible)
                || [...document.querySelectorAll('[contenteditable="true"]')].filter(visible).pop();
            return el ? (el.innerText || el.textContent || '').trim() : '';
        });
        const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
        const expected = norm(prompt).slice(0, 48);
        const actual = norm(readBack);
        if (!actual || (expected && !actual.includes(expected))) {
            throw new Error(`prompt was not written into the Extend box (read back ${actual.length} characters)`);
        }
        log(`   ✅ Prompt entered and verified (${actual.length} characters)`);
    }

    // Placeholder text disappears when the editor contains whitespace or a
    // previous prompt. A composing timeline slot plus the active Extend
    // composer remains authoritative in that state.
    extendArmedJs() {
        return (() => {
            const ph = document.querySelector('.prosemirror-placeholder');
            if (ph && /What happens next/i.test(ph.textContent || '')) return true;
            const pm = document.querySelector('.ProseMirror');
            if (pm && /What happens next/i.test(pm.textContent || '')) return true;
            const active = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')]
                .find(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
            const composing = document.querySelector('.clip.extend-composing, .extend-composing-content');
            const controls = [...document.querySelectorAll('button')];
            const extendControl = controls.some(b => /exit extend mode/i.test(b.getAttribute('aria-label') || '')
                || /^Extend\s*\(Veo/i.test((b.innerText || b.textContent || '').trim()));
            return !!(active && composing && extendControl)
                || /exit extend mode/i.test(document.body.innerText || '');
        })();
    }

    // ── reference upload + attach as ingredient ──────────────
    // Full flow: click + (add) -> pick existing asset OR "Upload media" ->
    // select the ref in the picker -> "Add to prompt". Uploading alone does
    // NOT attach the ref - without "Add to prompt" the generation ignores it.
    async uploadRef(filePath) {
        const base = path.basename(filePath).replace(/\.[^.]+$/, '');
        log(`   📤 Uploading + attaching ref: ${path.basename(filePath)}`);

        // Open the + (add) menu, retrying - it is flaky on first click
        let menuOpen = false;
        for (let attempt = 1; attempt <= 4 && !menuOpen; attempt++) {
            menuOpen = await this.evalJs(() => {
                const add = [...document.querySelectorAll('button')].find(b => {
                    if ((b.getAttribute('aria-label') || '').includes('Add ingredients')) return true;
                    const icon = b.querySelector('.add-menu-icon, mat-icon.google-symbols');
                    return icon && icon.textContent.trim() === 'add';
                });
                if (!add) return false;
                add.click();
                return true;
            });
            if (!menuOpen) { log(`   ⚠️  no add (+) button (attempt ${attempt})`); await wait(2500); }
            else await wait(1500);
        }
        if (!menuOpen) { log('   ⚠️  add menu never opened'); return false; }

        // If the ref is already an asset in this project, select it directly;
        // otherwise upload it via Upload media first.
        const hasAsset = await this.evalJs((name) => {
            const ov = document.querySelector('.cdk-overlay-container');
            if (!ov) return false;
            return [...ov.querySelectorAll('button, [role=menuitem], a, [role=option]')]
                .some(x => new RegExp(name, 'i').test(x.innerText || ''));
        }, base);

        if (!hasAsset) {
            // The asset picker renders async (~2-3s), so POLL for the Upload
            // media item instead of checking once (a blind re-click toggles
            // the menu closed - the toggle race).
            let clickedUpload = false;
            for (let attempt = 1; attempt <= 5 && !clickedUpload; attempt++) {
                for (let poll = 0; poll < 10 && !clickedUpload; poll++) {
                    clickedUpload = await this.evalJs(() => {
                        const ov = document.querySelector('.cdk-overlay-container');
                        if (!ov) return false;
                        const up = [...ov.querySelectorAll('button, [role=menuitem], a')]
                            .find(x => x.querySelector('.upload-text') ||
                                       /upload media/i.test(x.innerText || x.getAttribute('aria-label') || ''));
                        if (!up) return false;
                        up.click();
                        return true;
                    });
                    if (clickedUpload) break;
                    await wait(800);
                }
                if (clickedUpload) break;
                log(`   ⚠️  no Upload media item (attempt ${attempt}/5) - reopening menu`);
                await this.evalJs(() => {
                    const bd = document.querySelector('.cdk-overlay-backdrop');
                    if (bd) bd.click();
                    return true;
                });
                await wait(2000);
                // reopen with the CORRECT + button (Add ingredients to the prompt box)
                await this.evalJs(() => {
                    const add = [...document.querySelectorAll('button')]
                        .find(b => (b.getAttribute('aria-label') || '').includes('Add ingredients'));
                    if (add) { add.click(); return true; }
                    return false;
                });
                await wait(2500);
            }
            if (!clickedUpload) { log('   ⚠️  Upload media never appeared'); return false; }
            await wait(1500);
            // wait for the new asset to appear in the picker
            for (let i = 0; i < 10; i++) {
                await wait(2000);
                const now = await this.evalJs((name) => {
                    const ov = document.querySelector('.cdk-overlay-container');
                    if (!ov) return false;
                    return [...ov.querySelectorAll('button, [role=menuitem], a, [role=option], [class*="asset"], img')]
                        .some(x => new RegExp(name, 'i').test(x.innerText || x.getAttribute('alt') || ''));
                }, base);
                if (now) break;
            }
        }

                        // Select the ref in the picker (or reopen the + menu which lists
        // project assets by name), then click "Add to prompt". The picker
        // often CLOSES after an upload - reopening shows the new asset.
        let added = false;
        for (let attempt = 1; attempt <= 6 && !added; attempt++) {
            await wait(2000);
            let overlayOpen = await this.evalJs(() => !!document.querySelector('.cdk-overlay-container'));
            if (!overlayOpen) {
                // reopen the + (add) menu
                await this.evalJs(() => {
                    const add = [...document.querySelectorAll('button')].find(b => {
                        if ((b.getAttribute('aria-label') || '').includes('Add ingredients')) return true;
                        const icon = b.querySelector('.add-menu-icon, mat-icon.google-symbols');
                        return icon && icon.textContent.trim() === 'add';
                    });
                    if (add) { add.click(); return true; }
                    return false;
                });
                await wait(2000);
            }
            const picked = await this.evalJs((name) => {
                const ov = document.querySelector('.cdk-overlay-container');
                if (!ov) return { state: 'no-overlay' };
                const rx = new RegExp(name.slice(0, 10), 'i');
                const item = [...ov.querySelectorAll('button, [role=menuitem], a, [role=option], [class*="asset"], [class*="item"], [class*="card"]')]
                    .find(x => rx.test(x.innerText || x.getAttribute('aria-label') || ''));
                if (item) { item.click(); return { state: 'selected-by-name' }; }
                const img = [...ov.querySelectorAll('img')].find(x => rx.test(x.alt || x.src || ''));
                if (img) { img.click(); return { state: 'selected-by-img' }; }
                return { state: 'no-item' };
            }, base);
            await wait(1500);
            // poll for the "Add to prompt" button for up to 8s
            for (let p2 = 0; p2 < 8; p2++) {
                added = await this.evalJs(() => {
                    const ov = document.querySelector('.cdk-overlay-container');
                    const scope = ov && ov.innerText ? ov : document;
                    const btn = [...scope.querySelectorAll('button')]
                        .find(x => /add to prompt/i.test(x.innerText || x.getAttribute('aria-label') || ''));
                    if (!btn) return false;
                    btn.click();
                    return true;
                });
                if (added) break;
                await wait(1000);
            }
            if (added) break;
            log(`   ⚠️  attach attempt ${attempt}/6 failed (state: ${picked ? picked.state : '?'}) - retrying via menu`);
            // close whatever is open before the retry
            await this.closeStrayOverlay();
            await wait(1500);
        }
        if (!added) {
            log('   ⚠️  "Add to prompt" never clicked - ref may not be attached!');
        } else {
            log('   ✅ Ref attached to prompt (Add to prompt clicked)');
        }
        await wait(2500);
        return true;
    }
async uploadRefViaSendKeys(filePath) {
        // Re-open the picker and let SendKeys fill the native dialog
        const opened = await this.evalJs(() => {
            const add = [...document.querySelectorAll('button')]
                .find(b => (b.getAttribute('aria-label') || '').includes('Add ingredients'));
            if (!add) return false;
            add.click();
            return true;
        });
        if (!opened) return;
        await wait(1500);
        await this.evalJs(() => {
            const ov = document.querySelector('.cdk-overlay-container');
            if (!ov) return false;
            const up = [...ov.querySelectorAll('button, [role=menuitem], a')]
                .find(x => /upload media/i.test(x.innerText || x.getAttribute('aria-label') || ''));
            if (!up) return false;
            up.click();
            return true;
        });
        await wait(2000);
        sendKeysToDialog(filePath);
        await wait(4000);
    }

    async uploadStoryRefs(scene) {
        if (this.skipRefs) { log('   (refs skipped - already in project)'); return; }
        // Every ref the scene needs - its cast AND the place, from the story's
        // refs.json where it has one. Uploading local sheets is only the
        // fallback path: normally the tiles are made inside the Flow project by
        // the ref generator and nothing is uploaded at all.
        for (const ref of this.refsFor(scene)) {
            const p = ref.file || this.characterReferences[ref.name] || '';
            const abs = p ? this.resolveRefPath(p, ref.name) : null;
            if (!abs) { log(`   ⚠️  no ref file for "${ref.name}"`); continue; }
            await this.uploadRef(abs);
            await wait(2000);
        }
    }

    // ── per-scene ingredient selection (extend mode) ───────────────────────
    // Reuses the reference sheets already uploaded to the project. The
    // "+ Add ingredients to the prompt box" button opens a virtual-scroll asset
    // picker (cdk-virtual-scroll-viewport[aria-label="Asset list"]) listing every
    // uploaded sheet by filename in span.asset-title. The viewport is
    // MULTI-SELECT (aria-multiselectable="true"), so we tick every character the
    // scene needs and press "Add to prompt" ONCE for all of them.
    async openAssetPicker() {
        // If it is already up, it is already open. Clicking "+" a second time
        // reads as "press the same button again" and CLOSES it, which is the
        // shape of the round-3 failure: the sheet was left open by round 2, the
        // "+" click shut it, and the log read "+ clicked but asset list not
        // rendered (attempt 1/4)" four times before the scene gave up.
        const isOpen = () => this.evalJs(() =>
            !!document.querySelector('cdk-virtual-scroll-viewport[aria-label="Asset list"]'));
        const ready = async () => {
            if (this.opts.referenceCategory === 'Images') {
                await require('./reference_picker_images').selectImages(this.page, {log});
            }
            return true;
        };
        if (await isOpen()) return ready();
        for (let attempt = 1; attempt <= 4; attempt++) {
            const opened = await this.evalJs(() => {
                const button = document.querySelector('button[aria-label="Add ingredients to the prompt box"]');
                if (!button) return false;
                button.click();
                return true;
            });
            if (opened) {
                await wait(1500);
                const ready = async () => {
            if (this.opts.referenceCategory === 'Images') {
                await require('./reference_picker_images').selectImages(this.page, {log});
            }
            return true;
        };
        if (await isOpen()) return ready();
                log(`   ⚠️  + clicked but asset list not rendered (attempt ${attempt}/4)`);
            } else {
                log(`   ⚠️  no "Add ingredients to the prompt box" button (attempt ${attempt}/4)`);
            }
            await wait(2000);
        }
        return false;
    }

    // Find one sheet by ANY of its spellings (see refAliases), inside the
    // picker. The list is virtualised, so walk it in viewport-sized steps if the
    // target is not rendered yet - not being rendered is NOT the same as not
    // being there, and treating the two as one is how a ref went missing.
    //
    // The tick is a REAL mouse click at the item's centre, with the selection
    // read back from aria-selected afterwards. Flow's Angular handlers ignore a
    // synthetic el.click() because it carries isTrusted:false - measured on
    // "Start generation" (see clickSubmit), and exactly the shape of the extend
    // run this was fixed for:
    //
    //   🧩 Attaching ingredients for scene 3: Studio
    //      Studio: clicked
    //   ⚠️  "Add to prompt" never clicked
    //      still missing: Studio - retrying        (twice, and then the picker
    //   ⚠️  + clicked but asset list not rendered    stopped re-opening too)
    //   ⚠️  only 0/1 ingredient(s) attached - MISSING: Studio
    //
    // The item was "clicked" and the tick never registered, so "Add to prompt"
    // stayed disabled and there was nothing to press - ten polls in a row. A
    // tick that does not take is an ingredient that never reaches the prompt:
    // the clip is generated without its reference and re-invents the place from
    // prose alone, which is the whole reason the refs exist.
    async findAssetItem(aliases) {
        const list = (Array.isArray(aliases) ? aliases : [aliases]).filter(Boolean);
        if (!list.length) return 'no-name';
        const LOCATE = (names, imagesOnly) => {
            const keys = names.map(s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
            const vp = document.querySelector('cdk-virtual-scroll-viewport[aria-label="Asset list"]')
                    || document.querySelector('.asset-list-viewport');
            if (!vp) return { state: 'no-picker' };
            const items = [...vp.querySelectorAll('button.asset-item')];
            const hit = items.find(b => {
                if (imagesOnly) {
                    const type = b.getAttribute('data-asset-type') || '';
                    const icons = [...b.querySelectorAll('mat-icon')].map(e => e.textContent || '').join(' ');
                    if (/video/i.test(type) || /\bVideo\s*$/i.test((b.innerText || '').trim())
                        || b.querySelector('video, flow-video-tile') || /play_circle|play_arrow|movie/i.test(icons)) return false;
                }
                const t = b.querySelector('.asset-title');
                if (!t) return false;
                const k = t.textContent.toLowerCase().replace(/[^a-z0-9]/g, '');
                // Exact on the key first; a containment test only for a
                // spelling long enough that it cannot match by accident
                // ("Godwin Reference Sheet" holds "godwin").
                return keys.some(n => k === n || (n.length >= 4 && (k.includes(n) || n.includes(k))));
            });
            if (hit) {
                // Current Flow is single-select and marks the chosen row with
                // asset-item-active; aria-selected remains "false" even when
                // Add to prompt is enabled for that row.
                if (hit.getAttribute('aria-selected') === 'true' || hit.classList.contains('asset-item-active')) {
                    return { state: 'already' };
                }
                // Centre it first. The actual click is made through a fresh
                // ElementHandle below. A cached screen coordinate can become
                // the Start generation button when Angular closes/reflows the
                // picker, which previously submitted a clip by accident.
                hit.scrollIntoView({ block: 'center' });
                return { state: 'hit', key: (hit.querySelector('.asset-title')?.textContent || '').trim(), count: items.length };
            }
            // not rendered yet - nudge the virtual scroller and retry
            const before = vp.scrollTop;
            vp.scrollTop = before + Math.max(40, vp.clientHeight * 0.9);
            return { state: 'scrolled', atEnd: vp.scrollTop === before, count: items.length };
        };
        for (let pass = 0; pass < 12; pass++) {
            const st = await this.evalJs(LOCATE, list, this.opts.referenceCategory === 'Images');
            if (!st || st.__error) return 'locate-error';
            if (st.state === 'no-picker') return st.state;
            if (st.state === 'already') return 'already';
            if (st.state === 'hit') {
                const handles = await this.page.$$('cdk-virtual-scroll-viewport[aria-label="Asset list"] button.asset-item');
                let hit = null;
                for (const h of handles) {
                    const title = await h.$eval('.asset-title', e => (e.textContent || '').trim()).catch(() => '');
                    if (title === st.key) { hit = h; break; }
                }
                if (!hit) return 'item-detached-before-click';
                try { await hit.click(); }
                catch { return 'item-detached-before-click'; }
                await wait(600);
                if ((await this.evalJs(LOCATE, list, this.opts.referenceCategory === 'Images')).state === 'already') return 'clicked';
                const pickerStillOpen = await this.evalJs(() =>
                    !!document.querySelector('cdk-virtual-scroll-viewport[aria-label="Asset list"]'));
                return pickerStillOpen ? 'clicked but NOT selected' : 'picker closed before selection was verified';
            }
            if (st.atEnd) return `not-found (${st.count} items visible)`;
            await wait(500);
        }
        return 'not-found (scroll exhausted)';
    }

    async selectRefsForScene(scene, sceneNum) {
        if (this.skipRefs) { log('   (refs skipped - ingredients already attached)'); return false; }
        const want = this.refsFor(scene);
        if (!want.length) {
            log('   (no reference images declared for this scene)');
            return false;
        }
        const wanted = want.map(r => r.name);

        log(`   🧩 Attaching ingredients for scene ${sceneNum}: ${wanted.join(', ')}`);

        // The current picker is SINGLE-select. Selecting Apartment after
        // Godwin replaces Godwin (asset-item-active moves to the new row), so
        // each ingredient must be applied in its own picker transaction.
        const attachedNames = new Set();
        for (const ref of want) {
            let landed = false;
            for (let attempt = 1; attempt <= 2 && !landed; attempt++) {
                const before = await this.ingredientChipState();
                await this.closeStrayOverlay();
                await wait(350);
                if (!await this.openAssetPicker()) {
                    log(`      ${ref.name}: ingredient picker did not open`);
                    continue;
                }
                const picked = await this.findAssetItem(refAliases(ref, this.characterReferences));
                log(`      ${ref.name}: ${picked}`);
                if (picked !== 'already' && picked !== 'clicked') {
                    await this.closeStrayOverlay();
                    continue;
                }
                if (!await this.clickAddToPrompt()) {
                    log(`      ${ref.name}: "Add to prompt" was not clicked`);
                    await this.closeStrayOverlay();
                    continue;
                }
                await wait(1600);
                const after = await this.ingredientChipState();
                if (after.disabled > before.disabled) {
                    log(`      ${ref.name}: Flow added an ERROR/DISABLED ingredient chip`);
                    break;
                }
                landed = after.count > before.count;
                if (!landed) log(`      ${ref.name}: no ingredient chip appeared; retrying`);
            }
            if (landed) attachedNames.add(ref.name);
        }

        const missing = want.filter(ref => !attachedNames.has(ref.name));
        const attached = attachedNames.size;
        if (!missing.length) {
            log(`   ✅ ${attached}/${wanted.length} ingredient(s) attached to prompt`);
            await wait(1000);
            return true;
        }
        // An honest failure. Name what is NOT on the prompt instead of counting
        // ticks: a clip that comes back without the room should say so here, not
        // in the finished film.
        log(`   ⚠️  only ${attached}/${wanted.length} ingredient(s) attached - MISSING: ${missing.map(r => r.name).join(', ')}`);
        log('      generation will not start until every required ingredient is attached');
        await this.closeStrayOverlay();
        return false;
    }

    // Put the narrator's voice on THIS clip's prompt box.
    //
    // Every clip, scene 1 included, because a voice in Flow is an ASSET on the
    // prompt box - not a setting on the project - so it has to be attached
    // again for each generation. A clip generated without one is narrated by
    // whatever voice Veo picks, which is how one film came back read by three
    // different people: the preset says "Alnilam" and no clip was ever told.
    //
    // Runs after the ingredients, and begins with Escape, so it is never
    // fighting a picker the ingredient step left open.
    async attachVoiceToScene(sceneNum) {
        if (this.noVoice || !this.flowVoice) return false;
        if (this.skipRefs) {
            log(`   🔊 voice skipped for scene ${sceneNum} (--skip-refs: the prompt already carries it)`);
            return false;
        }
        const name = this.flowVoice.name;
        log(`   🔊 Attaching voice "${name}" for scene ${sceneNum}`);
        const ok = await attachVoice(this.page, name, { log, wait });
        if (ok) log(`   ✅ "${name}" is on the scene ${sceneNum} prompt - this clip keeps the film's narrator`);
        else log(`   ⚠️  "${name}" could not be attached to scene ${sceneNum} - this clip may read in another voice`);
        return ok;
    }

    // Press the picker's "Add to prompt", which applies to every ticked asset.
    //
    // A REAL mouse click at the button's centre, for the reason measured on
    // "Start generation" (see clickSubmit): Flow's Angular handlers ignore a
    // synthetic el.click(), which carries isTrusted:false. This is the step the
    // extend run died on - the picker was open, the sheet was ticked, the button
    // was sitting there enabled, and ten polls of btn.click() in a row did
    // nothing at all, so the clip generated without its reference.
    //
    // It also says WHY when it cannot press. The old version returned a bare
    // false - "Add to prompt" never clicked - with no way to tell a missing
    // button from a disabled one, and those two need opposite fixes: a disabled
    // button means the TICK did not register (see findAssetItem), a missing one
    // means the picker is not the thing on screen.
    async clickAddToPrompt() {
        let why = null;
        for (let i = 0; i < 10; i++) {
            const where = await this.evalJs(() => {
                const ov = document.querySelector('.cdk-overlay-container');
                const scope = ov && ov.innerText ? ov : document;
                const btns = [...scope.querySelectorAll('button')];
                const btn = btns.find(x => /add to prompt/i.test(x.innerText || x.getAttribute('aria-label') || ''));
                if (!btn) {
                    return {
                        ok: false,
                        why: 'no "Add to prompt" button on screen',
                        seen: btns.map(b => String(b.innerText || b.getAttribute('aria-label') || '')
                            .replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8),
                    };
                }
                if (btn.disabled) return { ok: false, why: 'the button is disabled - the tick did not register' };
                const r = btn.getBoundingClientRect();
                if (!r.width || !r.height) return { ok: false, why: 'the button is not on screen' };
                return { ok: true, cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
            });
            if (where && where.ok) {
                const buttons = await this.page.$$('button');
                let button = null;
                for (const h of buttons) {
                    const label = await h.evaluate(x => x.innerText || x.getAttribute('aria-label') || '').catch(() => '');
                    if (/add to prompt/i.test(label)) { button = h; break; }
                }
                if (!button) { why = { why: 'the Add to prompt button detached before click' }; continue; }
                try { await button.click(); }
                catch { why = { why: 'the Add to prompt button detached before click' }; continue; }
                return true;
            }
            why = where || { why: 'the page did not answer' };
            await wait(1000);
        }
        // Say what was actually there. A silent false here cost a whole film's
        // worth of drift before anyone could see which of the two it was.
        if (why && why.why) log(`      (${why.why})`);
        if (why && why.seen && why.seen.length) {
            log(`      buttons on screen: ${why.seen.join(' | ')}`);
        }
        return false;
    }

    // ── scene 1 (project grid, text-to-video) ─────────────────────
    async prepareScene1(scene) {
        banner(`🎬 SCENE 1 SETUP: ${scene.scene_title || 'Scene 1'}`);
        // prompt box must be the "What do you want to create?" one
        if (this.opts.videoModel || this.opts.aspect || this._refsGenerated) {
            await require('./ingredients_setup').prepareVideo(this.page, {
                model: this.opts.videoModel || 'Flow', ratio: this.opts.aspect || 'Flow', log,
            });
        }
        if (!this._refsGenerated && !this.opts.noUploadRefs) await this.uploadStoryRefs(scene);
        const initialPrompt = this.story?.narration_scope === 'dialogue' && !String(scene.veo3_prompt).includes('AUDIO MIX:')
            ? scene.veo3_prompt + '\n' + require('./dialogue_speakers').audioMix() : scene.veo3_prompt;
        const initialAudio = require('./dialogue_speakers').withDialogueAudio(this.story, scene, initialPrompt);
        const brightInitial = require('./location_style').withBrightLocation(this.story, initialAudio);
        const directedInitial = require('./dialogue_shot_plan').shotPlan(this.story, scene);
        await this.typePrompt(directedInitial ? directedInitial.prompt : require('./ingredients_camera').ingredientsCameraPrompt(this.story, scene, brightInitial));
        // The sheets attached to clip 1 as well, when asked for. See the
        // refsOnClip1 comment in the constructor.
        if (this.refsOnClip1) {
            const required = this.refsFor(scene);
            const attached = await this.selectRefsForScene(scene, 1);
            if (!this.skipRefs && required.length && !attached) {
                throw Error('scene 1: not all required ingredients were attached; generation was not started');
            }
        }
        // The voice is NOT opt-in the way the sheets are: clip 1 is where the
        // narrator is set for the whole film, and a clip 1 read by the wrong
        // voice makes every extend that follows it sound wrong too.
        await this.attachVoiceToScene(1);
        log('');
        if (this.opts.autoStart) {
            await this.clickStartGeneration();
            await this.autoApproveCredits();
            log('Batch: first-clip generation submitted and confirmed.');
        } else {
            log('IN BROWSER: check video settings, then click Start generation.');
        }
        log('Waiting for generation to start and finish... (max 12 min)');
        const deadline = Date.now() + 720000;
        const started = Date.now();
        let sawGenerating = false;
        this._lastMoveAt = Date.now();
        this._lastPct = -1;
        this._lastEmittedPct = -1;
        this._heals = 0;
        while (Date.now() < deadline) {
            await wait(CONFIG.CHECK_INTERVAL);
            const st = await this.evalJs((pat) => ({
                url: location.href,
                generating: [...document.querySelectorAll('button')].some(b => /^stop(?: generation)?$/i.test(
                    (b.innerText || b.getAttribute('aria-label') || b.getAttribute('title') || '').trim())),
                approve: [...document.querySelectorAll('button')]
                    .some(b => /always approve/i.test(b.innerText || '') || (b.innerText || '').trim() === 'Approve'),
                creditsOut: new RegExp(pat.creditsOut, 'i').test(document.body.innerText || ''),
                // Stricter than the shared probe on purpose: on the project
                // grid a failed tile from an earlier attempt is still on
                // screen, and body-wide text would match that instead.
                failed: [...document.querySelectorAll('*')].some(e => {
                    const t = (e.textContent || '').trim();
                    const r = e.getBoundingClientRect();
                    return e.children.length < 3 && r.width > 0 &&
                        new RegExp(pat.errorText, 'i').test(t) && t.length < 120;
                }),
            }), this.cfg.patterns);
            if (st.__error) continue;
            if (st.creditsOut || await this.checkCreditsOut()) throw new Error('CREDITS_EXHAUSTED');
            if (st.approve) await this.autoApproveCredits();
            if (st.failed) throw new Error('Scene 1 generation FAILED in browser');
            if (st.generating) { if (!sawGenerating) { sawGenerating = true; log('   🔄 Generating...'); }                await this.reportProgress(1, ((Date.now() - started) / 180000) * 95, 'generating');
                // The first render is the slowest, so scene 1 gets a longer
                // fuse before we call it stuck.
                if (Date.now() - this._lastMoveAt > CONFIG.stallMs * 2 && this._heals < 3) {
                    await this.healStalled('scene 1 generation quiet', true);
                    this._lastMoveAt = Date.now();
                }
                continue; }
            if (sawGenerating || this.isEditorUrl(st.url)) {
                // generation likely done - look for the clip tile / editor
                if (this.isEditorUrl(st.url)) {
                    log('   EDITOR-OPEN');
                    await this.waitForEditorReady();
                    await this.clickNewestClip();
                    return;
                }
                // click newest tile to enter editor
                const tiles = await this.page.$$('flow-video-tile');
                const newest = tiles[tiles.length - 1];
                const clicked = !!newest;
                if (newest) await newest.click();
                if (clicked) {
                    await wait(8000);
                    if (this.isEditorUrl(this.page.url())) {
                        log('   ✅ Clip ready, editor open');
                        await this.waitForEditorReady();
                        await this.clickNewestClip();
                        return;
                    }
                }
            }
        }
        throw new Error('Scene 1: timed out waiting for clip/editor');
    }

    // ── scenes 2+ (extend in editor) ──────────────────────────────
    async ensureEditor() {
        if (this.isEditorUrl(this.page.url())) return this.waitForEditorReady();
        // Poll for up to 60s - the editor may open in any tab of the
        // AUTOMATION browser (not your personal Chrome!).
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            const pages = await this.browser.pages();
            const ep = pages.find(p => this.isEditorUrl(p.url()) && (!this.projectUrl || p.url().startsWith(this.projectUrl + '/')));
            if (ep) { this.page = ep; log('✅ Found editor tab'); return this.waitForEditorReady(); }
            await wait(3000);
        }
        // Self-recover: if we are on the project grid, click the newest tile
        const urls = (await this.browser.pages()).map(p => (p.url() || '').slice(0, 80));
        log(`   ⚠️  No editor tab. Open tabs: ${JSON.stringify(urls)}`);
        if (/flow\.google\.com\/project/.test(this.page.url() || '') && !/\/(scene|edit)\//.test(this.page.url())) {
            log('   🖱️  Clicking newest clip tile to open the editor...');
            const tiles = await this.page.$$('flow-video-tile');
            const newest = tiles[tiles.length - 1];
            const clicked = !!newest;
            if (newest) await newest.click();
            if (clicked) {
                await wait(8000);
                if (this.isEditorUrl(this.page.url())) return this.waitForEditorReady();
            }
        }
        await this.waitForUserInput('   Open the scene editor in the AUTOMATION browser window, then press ENTER... ');
        const pages2 = await this.browser.pages();
        const ep2 = pages2.find(p => this.isEditorUrl(p.url()));
        if (!ep2) throw new Error('Editor not found');
        this.page = ep2;
        return this.waitForEditorReady();
    }

    async prepareExistingTimelineResume() {
        if (this.resumeIgnoredNewProject) {
            log('   Resume safeguard: ignored --new-project because --from is greater than 1.');
        }
        if (this.resumeIgnoredGenRefs) {
            log('   Resume safeguard: ignored --gen-refs; reference phase is already complete.');
        }

        // Prefer the editor belonging to the supplied project. With several
        // Flow tabs open, connect() may have attached to a different project.
        if (this.projectUrl) {
            this.projectUrl = require('./flow_project').normalizeProjectUrl(this.projectUrl);
            const pages = await this.browser.pages();
            const editor = pages.find(p => this.isEditorUrl(p.url()) &&
                p.url().startsWith(this.projectUrl + '/'));
            if (editor) this.page = editor;
            else if (!this.page.url().startsWith(this.projectUrl)) {
                log(`🌐 Opening existing project for resume: ${this.projectUrl}`);
                await this.page.goto(this.projectUrl, {
                    waitUntil: 'domcontentloaded', timeout: 120000,
                });
                await this.waitForFlowShell();
            }
        }

        await this.ensureEditor();
        // Once an editor was found from the open browser, remember its project
        // even when the GUI's URL box was empty.
        if (!this.projectUrl) {
            try { this.projectUrl = require('./flow_project').normalizeProjectUrl(this.page.url()); }
            catch {}
        }

        const clips = await this.countClips();
        const pending = await this.countEmptySlots();
        if (pending > 1) {
            throw new Error(`Resume found ${pending} unfinished Extend slots. Keep only the latest one before retrying.`);
        }
        const completed = await this.countCompletedClips();
        const expected = this.fromScene - 1;
        if (completed !== expected) {
            throw new Error(`Resume requested from scene ${this.fromScene}, but the open timeline has ` +
                `${completed} completed clip(s); expected exactly ${expected}. Set From to ${completed + 1} ` +
                `or open the correct project before retrying.`);
        }
        // A failed attempt can leave one full-size .clip.extend-composing node.
        // Select the completed clip immediately before it; doExtendScene() will
        // reuse the unfinished slot instead of arming another Extend.
        const selected = pending
            ? await this.clickNewestCompletedClip()
            : await this.clickNewestClip();
        if (!selected) {
            throw new Error(`Could not select the newest existing clip before extending scene ${this.fromScene}.`);
        }
        if (pending) log('   ♻️  Found one unfinished Extend slot; it will be reused for this scene.');
        log(`✅ Resume ready: ${completed} completed clip(s); scene ${this.fromScene} will be added with Extend.`);
    }

    // The editor takes 30-60s to hydrate (canvas, "Add clip" button). Wait for it.
    async waitForEditorReady(maxWaitMs = 120000) {
        this._editorSeen = true; // grid and resume paths both end here
        log('   ⏳ Waiting for editor to fully load (Add clip button)...');
        const deadline = Date.now() + maxWaitMs;
        while (Date.now() < deadline) {
            const ready = await this.evalJs((sel) => ({
                addClip: [...document.querySelectorAll('button')]
                    .some(b => (b.getAttribute('aria-label') || '') === sel.addClipLabel),
                armed: (() => {
                    const ph = document.querySelector(sel.placeholderSelector);
                    return (ph && new RegExp(sel.extendPlaceholder, 'i').test(ph.textContent || '')) ||
                           /exit extend mode/i.test(document.body.innerText || '');
                })(),
                secs: (() => {
                    // readouts like "00:08:00" = MM:SS:FF
                    let max = 0;
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                    while (walker.nextNode()) {
                        const t = walker.currentNode.textContent.trim();
                        const g = t.match(/^(\d{2}):(\d{2}):(\d{2})$/);
                        if (g) max = Math.max(max, (+g[1]) * 60 + (+g[2]));
                    }
                    return max;
                })(),
            }), this.sel);
            if (!ready.__error && (ready.addClip || ready.armed || await this.isExtendArmed())) {
                log(`   ✅ Editor ready (timeline ~${ready.secs}s)`);
                return true;
            }
            await wait(4000);
        }
        throw new Error('Editor did not become ready (no Add clip button within 2 min)');
    }

    // "Is extend mode armed?" was probed in four places with slightly
    // different selectors, which meant they could disagree - one would see
    // the armed placeholder and another would re-click Add clip on top of it.
    // One probe, one answer.
    async isExtendArmed() {
        const r = await this.evalJs(this.extendArmedJs);
        return r === true;
    }

    // Close a stray overlay without touching anything else. Called between
    // arm attempts; harmless when nothing is open.
    async closeStrayOverlay() {
        await this.evalJs((sel) => {
            const bd = document.querySelector(`${sel.overlayContainerSelector} .cdk-overlay-backdrop`)
                    || document.querySelector('.cdk-overlay-backdrop');
            if (bd) bd.click();
        }, this.sel);
    }

    async armExtend(sceneNum) {
        log(`   🔗 Arming EXTEND mode for scene ${sceneNum}...`);
        // if already armed ("What happens next?" placeholder), reuse
        if (await this.isExtendArmed()) { log('   ✅ Extend mode already armed'); return; }

        // Seen when the menu opens and genuinely holds no Extend entry. That is
        // a fact about the plan, not a transient miss, so it is counted: three
        // identical reads is enough to stop, where twelve retries only burn
        // about ninety seconds to reach the same conclusion.
        let noExtendSeen = 0;
        for (let attempt = 1; attempt <= 12; attempt++) {
            if (await this.isExtendArmed()) { log('   ✅ Existing Extend composer ready'); return; }
            const ok = await this.evalJs((sel) => {
                const addClip = [...document.querySelectorAll('button')]
                    .find(b => (b.getAttribute('aria-label') || '') === sel.addClipLabel);
                if (!addClip) return { step: 'no Add clip' };
                addClip.click();
                return { step: 'clicked' };
            }, this.sel);
            if (ok.__error || !ok || ok.step !== 'clicked') {
                log(`   ⚠️  attempt ${attempt}/12: no Add clip button (${(ok && ok.step) || 'err'})`);
                await wait(5000);
                continue;
            }
            await wait(2500);
            const picked = await this.evalJs((wantModel, sel, strictModel) => {
                const ov = document.querySelector(sel.overlayContainerSelector);
                if (!ov) return { state: 'no-overlay' };
                // Every extend entry reads "Extend (Veo ...)"; the plan decides
                // which model suffix appears. Prefer the configured model, then
                // fall back to any Veo extend entry so a plan change can't stall.
                const items = [...ov.querySelectorAll('button, [role=menuitem], a, [role=option]')]
                    .filter(x => /extend/i.test(x.innerText || '') && /veo/i.test(x.innerText || ''));
                if (!items.length) {
                    // Dump what the menu DOES hold - far more useful than a bare
                    // "no item" when a plan or a label changes underneath us.
                    const offered = [...ov.querySelectorAll('button, [role=menuitem], a, [role=option]')]
                        .map(x => (x.innerText || '').trim().slice(0, 60))
                        .filter(Boolean).slice(0, 12);
                    return { state: 'no-extend-item', offered };
                }
                const labelOf = (el) => {
                    const l = el.querySelector('.label');
                    return ((l ? l.textContent : el.innerText) || '').trim();
                };
                const key = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
                const pref = items.find(x => key(labelOf(x).replace(/^extend\s*\(/i, '').replace(/\)$/, '')) === key(wantModel));
                if (!pref && strictModel) return { state: 'model-unavailable', offered: items.map(labelOf) };
                const item = pref || items[0];
                item.click();
                return { state: 'clicked', model: labelOf(item).slice(0, 70), preferred: !!pref,
                         available: items.map(x => labelOf(x).slice(0, 70)) };
            }, this.extendModel, this.sel, !!this.opts.videoModel && this.opts.videoModel !== 'Flow');
            if (picked && picked.state === 'model-unavailable') {
                throw Error(`Selected model "${this.extendModel}" is not offered for Extend. Available: ${picked.offered.join(', ')}`);
            }
            if (!picked || picked.state !== 'clicked') {
                // Never leave a bare "undefined" here again. That single word -
                // "Extend menu problem: undefined" - is the reason this whole
                // path was once set aside: it named no cause, so the only
                // conclusion available was "the plan does not offer it". Name
                // the real reason instead.
                if (picked && picked.__error) {
                    log(`   Extend menu: page error - ${picked.__error}`);
                } else if (picked && picked.state === 'no-overlay') {
                    log('   Extend menu: no overlay appeared after clicking "Add clip"');
                } else if (picked && picked.state === 'no-extend-item') {
                    noExtendSeen++;
                    log(`   Extend menu: opened, but holds no "Extend (Veo ...)" entry `
                        + `(${noExtendSeen}/3 before giving up)`);
                    if (picked.offered && picked.offered.length) {
                        log(`      it contains: ${picked.offered.join(' | ')}`);
                    }
                    if (noExtendSeen >= 3 && picked.offered && picked.offered.length) {
                        throw new Error(
                            `This Flow plan does not offer Extend in the "Add clip" menu `
                            + `(scene ${sceneNum}). The menu holds: `
                            + `${picked.offered.join(' | ')}. Run "node probe_extend.js" to `
                            + `confirm it, and use Agent Mode for this story instead.`);
                    }
                } else {
                    log(`   Extend menu: unrecognised reply ${JSON.stringify(picked)}`);
                }
            }
            if (picked && picked.state === 'clicked') {
                if (!picked.preferred && this.opts.videoModel && this.opts.videoModel !== 'Flow') {
                    throw Error(`The selected video model "${this.extendModel}" is not offered for Extend. No extension submitted.`);
                }
                log(picked.preferred
                    ? `   Extend model: ${picked.model}`
                    : `   WARNING: "${this.extendModel}" not offered - using: ${picked.model}`);
                if (!picked.preferred && picked.available) {
                    log(`   Models actually offered here: ${picked.available.join(' | ')}`);
                }
                // give the editor a moment, then verify via the placeholder span
                await wait(3500);
                const verify = await this.isExtendArmed();
                if (verify) { log('   ✅ Extend armed (What happens next? shown)'); return; }
                log('   ⚠️  Extend item clicked but placeholder not confirmed - re-checking...');
                await wait(3000);
                const verify2 = await this.isExtendArmed();
                if (verify2) { log('   ✅ Extend armed (late confirm)'); return; }
            }
            // only close a stray overlay if NOT armed
            await this.closeStrayOverlay();
            await wait(2000);
        }
        throw new Error(`armExtend failed for scene ${sceneNum}`);
    }

    async clickStartGeneration() {
        const button = await this.page.$('button[aria-label="Start generation"]');
        if (!button) throw new Error('Start generation (arrow_forward) button not found');
        const disabled = await button.evaluate(b => b.disabled || b.getAttribute('aria-disabled') === 'true');
        if (disabled) throw new Error('Start generation button is disabled');
        try { await button.click(); }
        catch (e) { throw new Error(`Start generation click failed: ${e.message}`); }

        // Never claim submission from the click alone. Flow used to ignore the
        // synthetic click silently, leaving the prompt untouched. Accept only a
        // visible state transition: Stop, an approval dialog, or the Start
        // control becoming unavailable/disabled after the click.
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
            await wait(400);
            const state = await this.evalJs(() => {
                const buttons = [...document.querySelectorAll('button')];
                const start = buttons.find(b => /start generation/i.test(b.getAttribute('aria-label') || ''));
                const stop = buttons.some(b => /^stop(?: generation)?$/i.test(
                    (b.innerText || b.getAttribute('aria-label') || b.getAttribute('title') || '').trim()));
                const approve = buttons.some(b => /always approve/i.test(b.innerText || '') ||
                    (b.innerText || '').trim() === 'Approve');
                return { stop, approve, startGone: !start, startDisabled: !!start &&
                    (start.disabled || start.getAttribute('aria-disabled') === 'true') };
            });
            if (state && !state.__error && (state.stop || state.approve || state.startGone || state.startDisabled)) {
                log('   ✅ Start generation submitted and confirmed');
                return true;
            }
        }
        throw new Error('Start generation click was not confirmed; the prompt was not submitted');
    }

    async autoApproveCredits() {
        const clicked = await this.evalJs(() => {
            const btns = [...document.querySelectorAll('button')];
            const b = btns.find(x => /always approve/i.test(x.innerText || '')) ||
                      btns.find(x => (x.innerText || '').trim() === 'Approve');
            if (b) { b.click(); return (b.innerText || '').trim(); }
            return null;
        });
        if (clicked) { log(`   💳 Approved credits dialog (${clicked})`); await wait(1500); }
        return !!clicked;
    }

    // Out-of-credits: Flow shows a "get more credits" style message when
    // the signed-in account's monthly Veo allowance is spent. Sniffed during
    // the generation polls so a drained account stops the run instead of
    // every remaining scene failing one by one.
    async checkCreditsOut() {
        if (this._creditsOut) return true;
        try {
            const out = await this.evalJs((src) => {
                const t = (document.body && document.body.innerText) || '';
                return new RegExp(src, 'i').test(t);
            }, this.cfg.patterns.creditsOut);
            if (out && !out.__error) { this._creditsOut = true; return true; }
        } catch {}
        return false;
    }

    // Charge this clip to the active account's monthly counter.
    _countClip() {
        if (!this.accountLabel) return;
        try {
            const am = require('./account_manager.js');
            const acc = am.countClip(this.accountLabel);
            if (acc) log(`   credits: ${acc.label} ${acc.clips_used}/${acc.max_clips} clips this month`);
        } catch {}
    }

    // Completion = timeline duration grew by one clip. That is the reliable
    // signal (clips land in 15-20s with Veo 3.1 Lite). No placeholder check -
    // the UI does not consistently restore it after generation.
        // Count EMPTY reserved extend slots on the timeline ("Prompt to extend").
    // Arming extend adds one instantly; a completed generation removes it.
    async countEmptySlots() {
        const n = await this.evalJs((sel) => document.querySelectorAll(sel).length, this.sel.emptySlotSelector);
        return (typeof n === 'number') ? n : 0;
    }

    // How many clips are on the timeline. This is the strongest structural
    // signal available: one completed extend must add exactly one clip.
    async countClips() {
        const n = await this.evalJs((sel) => document.querySelectorAll(sel).length, this.sel.clipsSelector);
        return (typeof n === 'number') ? n : 0;
    }

    // Extend mode keeps a .clip.extend-composing insertion control on the
    // timeline. It can remain there after a real generated clip is appended,
    // so it is neither a pending job nor a completion signal. Count only video
    // clips for resume validation and generation completion.
    async countCompletedClips() {
        const n = await this.evalJs((sel) => [...document.querySelectorAll(sel)]
            .filter(c => !c.classList.contains('extend-composing') &&
                !c.querySelector('.extend-placeholder-text')).length, this.sel.clipsSelector);
        return (typeof n === 'number') ? n : 0;
    }

    async waitForExtendComplete(sceneNum, prevSeconds, completedBefore) {
        // A clip typically lands in 15-60s. Current Flow creates a full
        // .clip.extend-composing node as soon as Extend is armed, so timeline
        // duration alone is not completion. Combine the slot lifecycle, the
        // Stop control and the minimum wait before moving to the next scene.
        const minWaitMs = CONFIG.minClipWaitMs;   // never proceed before this
        const target = prevSeconds + CONFIG.SCENE_SECONDS - 1;
        const deadline = Date.now() + CONFIG.maxGenerationMs;

        log(`   Waiting ${Math.round(minWaitMs / 1000)}s minimum for scene ${sceneNum} clip to generate...`);
        this._lastMoveAt = Date.now();
        this._lastPct = -1;
        this._lastEmittedPct = -1;
        this._heals = 0;
        const started = Date.now();

        let failedEarly = false;
        let sawGenerating = false;
        // Phase 1: the mandatory quiet period. Nothing is expected on the
        // timeline yet, so no watchdog here - it would fire on a healthy job.
        const minEnd = started + minWaitMs;
        while (Date.now() < minEnd) {
            await wait(CONFIG.progressPollMs);
            const st = await this.readState();
            if (!st) continue;
            if (st.creditsOut || await this.checkCreditsOut()) throw new Error('CREDITS_EXHAUSTED');
            if (st.approve) await this.autoApproveCredits();
            if (st.failed) { failedEarly = true; break; }
            if (st.generating) sawGenerating = true;
            await this.reportProgress(sceneNum, ((Date.now() - started) / minWaitMs) * 40, 'generating');
        }
        if (failedEarly) throw new Error(`Scene ${sceneNum} generation FAILED (Flow error text visible)`);

        // Phase 2: wait for the timeline to reach the expected duration. The
        // clock starts here, so "silence" means the timeline has not grown
        // and Flow has not reported a new percentage - the two signs that the
        // job is actually alive.
        this._lastMoveAt = Date.now();
        let lastSecs = prevSeconds;
        while (Date.now() < deadline) {
            const secs = await this.getTimelineSeconds();
            if (secs > lastSecs) { lastSecs = secs; this._lastMoveAt = Date.now(); }
            const st = await this.readState();
            if ((st && st.creditsOut) || await this.checkCreditsOut()) throw new Error('CREDITS_EXHAUSTED');
            if (st && st.approve) await this.autoApproveCredits();
            if (st && st.failed) { failedEarly = true; break; }
            if (st && st.generating) sawGenerating = true;
            const completed = await this.countCompletedClips();
            const generationStopped = !sawGenerating || !st || !st.generating;
            // The insertion control can remain after generation. The only safe
            // completion signal is a new real clip plus generation stopping.
            if (completed >= completedBefore + 1 && generationStopped) {
                await wait(5000);
                log(`   Clip generation complete (${completedBefore} -> ${completed} completed clips, timeline ${secs}s)`);
                return secs;
            }
            const pct = await this.reportProgress(
                sceneNum, 40 + ((Date.now() - started) / CONFIG.maxGenerationMs) * 59, 'waiting for timeline');

            if (Date.now() - this._lastMoveAt > CONFIG.stallMs && this._heals < 3) {
                const r = await this.healStalled(
                    `scene ${sceneNum} quiet ${Math.round(CONFIG.stallMs / 1000)}s at ${pct}%`, true);
                if (r.errorText) { failedEarly = true; break; }
                this._lastMoveAt = Date.now();
            }
            // This interval is also the watchdog's reaction time, so a page
            // that sticks is noticed within one poll rather than at timeout.
            await wait(CONFIG.timelinePollMs);
        }
        if (failedEarly) throw new Error(`Scene ${sceneNum} generation FAILED (page reported an error)`);
        throw new Error(`Scene ${sceneNum}: TIMEOUT waiting for generation`);
    }
    // The timeline scrolls horizontally and is usually zoomed IN, so pinning
    // the view to the far right keeps the newest clip on screen before we click
    // it. (Selection itself is DOM-based - see clickNewestClip.)
    async scrollTimelineToEnd() {
        const r = await this.evalJs(() => {
            // .timeline-area is the real horizontal scroller (confirmed by probe).
            // Fall back to the first scrollable div if Flow renames it.
            let scroller = document.querySelector('.timeline-area');
            if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 8) {
                scroller = null;
                for (const el of document.querySelectorAll('div')) {
                    const ox = getComputedStyle(el).overflowX;
                    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 8) {
                        scroller = el; break;
                    }
                }
            }
            if (!scroller) return { ok: false };
            const before = scroller.scrollLeft;
            scroller.scrollLeft = scroller.scrollWidth;
            return { ok: true, before: Math.round(before),
                     left: Math.round(scroller.scrollLeft),
                     max: Math.round(scroller.scrollWidth - scroller.clientWidth) };
        });
        if (r && r.ok) {
            log(`   ↔️  Timeline pinned to end (${r.left}/${r.max}px)`);
            await wait(1200);
        } else {
            log('   ↔️  no horizontal timeline scroller found - clicking blind');
        }
    }

    // export & split
    // Select the newly generated clip so the NEXT extend appends after it.
    //
    // CORRECTION (verified against the live editor by probe_editor.js): the
    // timeline is NOT a canvas. The only <canvas> in the scene editor is
    // .video-canvas, which is the video PREVIEW. Timeline clips are real DOM:
    // div.clip inside .timeline-contents, each with a .clip-body drag surface
    // and is-first / is-last / selected classes. The newest clip is simply the
    // LAST one - so select it by clicking its own body, with no coordinate
    // guessing based on the preview canvas.
    async clickNewestClip() {
        await this.scrollTimelineToEnd();
        const pt = await this.evalJs(() => {
            const clips = [...document.querySelectorAll('.timeline-contents .clip')];
            if (!clips.length) return null;
            const last = clips[clips.length - 1];
            const body = last.querySelector('.clip-body') || last;
            const r = body.getBoundingClientRect();
            return {
                x: Math.round(r.x + r.width / 2),
                y: Math.round(r.y + r.height / 2),
                count: clips.length,
                alreadySelected: last.classList.contains('selected'),
                isLast: last.classList.contains('is-last'),
                w: Math.round(r.width),
                hasSlot: !!document.querySelector('.extend-placeholder-text'),
            };
        });
        if (!pt || pt.__error) {
            log('   WARN: no .timeline-contents .clip found - cannot select the newest clip');
            return false;
        }
        if (pt.alreadySelected) {
            log(`   OK: newest clip (${pt.count}/${pt.count}, ${pt.w}px) is already selected - skipping click`);
            return true;
        }
        await this.page.mouse.click(pt.x, pt.y);
        log(`   Clicked newest clip at x=${pt.x} y=${pt.y} (clip ${pt.count}, ${pt.w}px)`);
        await wait(1200);
        // Confirm the click actually landed: the last clip must now carry
        // .selected. If it does not, the next extend appends after whatever IS
        // selected - which is exactly how a sequence gets scrambled.
        const ok = await this.evalJs(() => {
            const clips = [...document.querySelectorAll('.timeline-contents .clip')];
            return clips.length ? clips[clips.length - 1].classList.contains('selected') : false;
        });
        if (ok === true) {
            log(`   OK: clip ${pt.count} of ${pt.count} (the newest) is selected`);
            return true;
        }
        log(`   WARN: could not confirm the newest clip is selected (${pt.count} clips on timeline)`);
        return false;
    }

    async clickNewestCompletedClip() {
        await this.scrollTimelineToEnd();
        const pt = await this.evalJs(() => {
            const clips = [...document.querySelectorAll('.timeline-contents .clip')];
            const completed = clips.filter(c =>
                !c.classList.contains('extend-composing') &&
                !c.querySelector('.extend-placeholder-text'));
            if (!completed.length) return null;
            const clip = completed[completed.length - 1];
            const body = clip.querySelector('.clip-body') || clip;
            const r = body.getBoundingClientRect();
            return {
                x: Math.round(r.x + r.width / 2),
                y: Math.round(r.y + r.height / 2),
                index: clips.indexOf(clip) + 1,
                count: clips.length,
                alreadySelected: clip.classList.contains('selected'),
            };
        });
        if (!pt || pt.__error) return false;
        if (!pt.alreadySelected) {
            await this.page.mouse.click(pt.x, pt.y);
            await wait(1200);
        }
        const ok = await this.evalJs((index) => {
            const clips = [...document.querySelectorAll('.timeline-contents .clip')];
            return !!clips[index - 1]?.classList.contains('selected');
        }, pt.index);
        if (ok === true) {
            log(`   OK: newest completed clip (${pt.index}/${pt.count}) is selected`);
            return true;
        }
        log(`   WARN: could not select newest completed clip (${pt.index}/${pt.count})`);
        return false;
    }
async doExtendScene(scene, sceneNum) {
        const completedAtEntry = await this.countCompletedClips();
        const expectedBefore = sceneNum - 1;
        if (completedAtEntry !== expectedBefore) {
            throw new Error(`scene ${sceneNum}: timeline has ${completedAtEntry} completed clips; expected ${expectedBefore}. ` +
                'Stopping before another prompt is added.');
        }
        const baseSelected = await this.clickNewestCompletedClip();
        if (!baseSelected) throw new Error(`scene ${sceneNum}: could not select completed clip ${expectedBefore}`);
        const totalBefore = await this.countClips();
        const pendingBefore = await this.countEmptySlots();
        if (pendingBefore > 1) {
            throw new Error(`timeline already has ${pendingBefore} unfinished Extend slots; remove the extras before retrying`);
        }
        // Flow now counts the reserved "Prompt to extend" slot as a .clip and
        // immediately adds eight seconds to the duration. It is not a completed
        // clip. Base every integrity check on completed clips only, so a retry
        // reuses the existing slot instead of stacking another one.
        this.clipsBeforeExtend = completedAtEntry;
        const rawPrev = await this.getTimelineSeconds();
        const prev = this.clipsBeforeExtend * CONFIG.SCENE_SECONDS;
        log(`   📏 Timeline before: ${rawPrev}s shown; ${this.clipsBeforeExtend} completed clip(s) (${prev}s)`);
        if (pendingBefore === 1) {
            log('   ♻️  Reusing the unfinished "Prompt to extend" slot from the previous attempt.');
        }
        if (pendingBefore === 0) await this.armExtend(sceneNum);
        else log('   ✅ Existing Extend slot is already armed');
        const slotsAfterArm = await this.countEmptySlots();
        this.clipsAfterArm = await this.countClips();
        log(`   📐 Reserved empty slots after arming: ${slotsAfterArm} | clips ${this.clipsBeforeExtend} -> ${this.clipsAfterArm}`);
        // Old Flow exposed a child marker; current Flow exposes a whole
        // .clip.extend-composing node. Accept either the detected pending slot
        // or one newly-added structural clip. Reject only when neither changed.
        if (slotsAfterArm === 0 && this.clipsAfterArm <= this.clipsBeforeExtend) {
            throw new Error('no empty slot was reserved after arming - extend did not engage');
        }
        // Ingredients/References-to-Video and Extend are separate Flow modes.
        // Veo 3.1 Lite supports both modes, but an Extend request cannot accept
        // newly attached image or voice ingredient chips. Clear any chip left
        // by an older failed run before writing/submitting this continuation.
        await this.removeIngredientChipsFromExtend();
        // Continuation prompt if one was derived for this scene, else the
        // scene's own prompt. The derived one exists precisely because the
        // scene's own prompt re-establishes the film rather than continuing it.
        const extendText = this.extendPrompts[sceneNum];
        if (extendText) log(`   ✍️  scene ${sceneNum}: continuation prompt (extend_prompts.json)`);
        const lockedPrompt = this.buildIdentityLockedExtendPrompt(scene, extendText || scene.veo3_prompt);
        await this.typePrompt(lockedPrompt);
        log(`   🧩 Extend scene ${sceneNum}: using the preceding clip for character, place and voice continuity`);
        await this.clickStartGeneration();
        await this.autoApproveCredits();
        const now = await this.waitForExtendComplete(sceneNum, prev, this.clipsBeforeExtend);
        const selected = await this.clickNewestClip();

        // INTEGRITY GUARD. One completed extend must leave exactly one MORE clip
        // than we started with. We deliberately record the count a second time
        // AFTER arming, because arming may insert a placeholder .clip node that
        // generation later converts in place - so "before" and "after" are not
        // the only two useful readings.
        //
        // This is a WARNING, not a fatal error, and deliberately so: the
        // mid-generation DOM has never been probed, so the exact placeholder
        // behaviour is unverified. A guard that aborts a healthy run is worse
        // than no guard. Once a live run shows what these numbers actually look
        // like, the unambiguous cases below can be promoted to hard failures.
        const clipsNow = await this.countClips();
        const pendingNow = await this.countEmptySlots();
        const completedNow = await this.countCompletedClips();
        const gained = completedNow - this.clipsBeforeExtend;
        log(`   CLIPS COMPLETE: ${this.clipsBeforeExtend} -> ${completedNow} ` +
            `(DOM clips ${this.clipsAfterArm} after arm -> ${clipsNow}, pending ${pendingNow}) | timeline ${prev}s -> ${now}s`);
        if (gained !== 1) {
            log(`   WARN: expected to gain exactly 1 clip for scene ${sceneNum}, gained ${gained}.`);
            log(`   WARN: the extend may have landed in the wrong place - check scene order before exporting.`);
            this.sequenceSuspect = true;
        }
        if (completedNow < this.clipsBeforeExtend) {
            throw new Error(
                `Scene ${sceneNum}: completed clip count DROPPED from ${this.clipsBeforeExtend} to ${completedNow}. ` +
                `A clip was lost - stopping before more credits are spent.`
            );
        }
        if (!selected) {
            log(`   WARN: scene ${sceneNum} clip may not be selected - the next extend could append in the wrong place`);
            this.sequenceSuspect = true;
        }
        this.okScenes.push(sceneNum);
        this._countClip();
        return now;
    }
    // Claim the download destination, so the export lands where we say rather
    // than wherever this browser profile was last told to put things. Best
    // effort on purpose: if CDP refuses, the recursive sweep still finds the
    // files, so a failure here costs a log line and nothing else.
    async setDownloadDir(dir) {
        fs.mkdirSync(dir, { recursive: true });
        try {
            const client = await this.page.target().createCDPSession();
            try {
                // Browser-wide, which is the modern call and the one that
                // covers downloads the page starts without a navigation.
                await client.send('Browser.setDownloadBehavior', {
                    behavior: 'allow', downloadPath: dir, eventsEnabled: true,
                });
            } catch (e) {
                await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
            }
            await client.detach().catch(() => {});
            log(`   📥 Downloads will land in: ${dir}`);
        } catch (e) {
            log(`   ⚠️  Could not claim the download folder (${String(e.message).slice(0, 80)})`);
            log('   ⚠️  Sweeping ~/Downloads as well, in case that is where they go');
        }
    }

    async exportSceneVideo() {
        banner('⬇️  EXPORTING FULL SCENE');
        await this.ensureEditor();
        await this.setDownloadDir(this.downloadDir);
        // Everything already there, under BOTH the folder we asked for and the
        // browser's own default. "New" is then a set difference, and it holds
        // even when the download-path call was ignored and the clips went to
        // ~/Downloads anyway - which is exactly what used to happen.
        // Recursive, because Flow does not leave them at the top level.
        const sweepRoots = [this.downloadDir, CONFIG.DOWNLOADS_DIR];
        const before = new Set(sweepRoots.flatMap(d => mp4sUnder(d).map(x => x.file)));

        const opened = await this.evalJs(() => {
            const btn = [...document.querySelectorAll('button')]
                .find(b => /^download scene$/i.test(b.getAttribute('aria-label') || '') ||
                           /^download scene$/i.test((b.innerText || '').trim()));
            if (!btn) return false;
            btn.click();
            return true;
        });
        if (!opened) throw new Error('Download scene button not found');
        await wait(4000);

        // dialog: pick format + click Download/Export
        const clicked = await this.evalJs(() => {
            const dlg = document.querySelector('.cdk-overlay-container');
            const scope = dlg && dlg.innerText ? dlg : document;
            const btns = [...scope.querySelectorAll('button')];
            const dl = btns.find(b => /^(download|export)$/i.test((b.innerText || '').trim())) ||
                       btns.find(b => /^download$/i.test(b.getAttribute('aria-label') || ''));
            if (!dl) return false;
            dl.click();
            return true;
        });
        if (!clicked) log('   ⚠️  no explicit download button in dialog - maybe export started directly');

        log('   ⏳ Waiting for the .mp4 to land in Downloads...');
        // Wait for the export to finish writing. "Finished" is not one file
        // arriving: Flow writes ONE FILE PER CLIP, so the set is polled until it
        // stops growing. this.okScenes.length is how many clips were asked for,
        // so the wait knows when to stop rather than guessing.
        const expected = this.okScenes.length || 1;
        const deadline = Date.now() + 600000;
        let files = [], dir = this.downloadDir, lastKey = null, streak = 0;
        while (Date.now() < deadline) {
            await wait(3000);
            const found = sweepRoots.flatMap(d => mp4sUnder(d))
                .filter(x => !before.has(x.file) && x.size > 100000)
                .sort((a, b) => flowClipOrder(a.file, b.file));
            const key = found.map(x => `${x.file}:${x.size}`).join('|');
            if (key && key === lastKey) {
                streak++;
                // Done once the count that was asked for has arrived and
                // stopped growing. A short set is accepted only after it has
                // sat still for a minute - a slow export looks exactly like a
                // complete small one for a single poll, and stopping there
                // would discard clips that were still on their way.
                if (found.length >= expected || streak >= 20) {
                    files = found.map(x => x.file);
                    dir = path.dirname(found[0].file);
                    break;
                }
            } else {
                streak = 0;
            }
            lastKey = key;
            if (found.length) log(`   ⏳ ${found.length} of ${expected} clip(s) written so far`);
        }
        if (!files.length) {
            throw new Error('Export produced no .mp4 anywhere - searched '
                + sweepRoots.join(' and ') + ', sub-folders included');
        }
        log(`   ✅ Downloaded: ${files.length} file(s)`);
        log(`   📂 Folder: ${dir}`);
        return { files, dir };
    }

    // Flow's export comes back as one file PER CLIP, so there is nothing to cut.
    // What there is, is an ordering problem - and a sharp one. The files are
    // named after the opening words of each clip's prompt, which for an extend
    // chain is the same for every clip after the first, and stamped with the
    // second Flow wrote them. Measured on a real 5-clip export of
    // stories/the_price_of_obligation, that write order was 2,5,3,4,1: the
    // establishing clip came back LAST. Naming the files scene-01..05 in the
    // order they downloaded would have silently produced a shuffled film - the
    // same failure as the Agent-Mode grid, reached a different way.
    //
    // So the order is established from the clips themselves, with the same
    // by-ear tool the Agent-Mode route uses: each file carries its own scene's
    // dialogue, whisper transcribes it locally, and the words identify the
    // scene. On that real export this resolved 5 of 5, exactly.
    //
    // If it cannot run, nothing is guessed at: the clips are left under their
    // own names in a folder beside them and the run says the order is unknown.
    async collectPerClipExport(files) {
        banner('🧩 COLLECTING PER-CLIP EXPORT');
        fs.mkdirSync(this.outputDir, { recursive: true });
        log(`   ${files.length} clip(s) came back separately - no cutting needed.`);

        const expect = this.okScenes.length;
        if (expect && files.length !== expect) {
            log(`   ⚠️  ${files.length} file(s) for ${expect} scene(s) in range - some may not have exported.`);
        }

        // A folder holding only THIS export, so the ordering tool cannot pick
        // up clips left behind by an earlier run. The downloaded originals are
        // copied, never moved or renamed, so the raw export stays as it landed.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const scratch = path.join(this.downloadDir, `run-${stamp}`);
        fs.mkdirSync(scratch, { recursive: true });
        const copied = [];
        files.slice().sort(flowClipOrder).forEach((f, i) => {
            const dest = path.join(scratch, `clip-${String(i + 1).padStart(2, '0')}.mp4`);
            try { fs.copyFileSync(f, dest); copied.push(dest); }
            catch (e) { log(`   ⚠️  could not copy ${path.basename(f)}: ${String(e.message).slice(0, 80)}`); }
        });
        if (!copied.length) {
            log('   ❌ nothing could be copied out of the export - leaving it where it is.');
            return [];
        }

        const heard = this.orderClipsByEar(scratch);
        const slots = expect ? this.okScenes.slice() : copied.map((_, i) => i + 1);
        const results = [];
        const claimed = new Set();
        const unplaced = [];

        const place = (srcFile, sceneNum, why) => {
            const name = `scene-${String(sceneNum).padStart(2, '0')}.mp4`;
            try {
                fs.copyFileSync(path.join(scratch, path.basename(srcFile)), path.join(this.outputDir, name));
                claimed.add(sceneNum);
                results.push(path.join(this.outputDir, name));
                log(`   ✅ ${name}  <-  ${path.basename(srcFile)}${why}`);
            } catch (e) { log(`   ❌ ${name}: ${String(e.message).slice(0, 80)}`); }
        };

        // Identified clips go to the scene they were heard to be.
        for (const file of copied.map(f => path.basename(f))) {
            const m = heard.byFile[file];
            if (!m || m.scene === null) { unplaced.push(file); continue; }
            if (!slots.includes(m.scene) || claimed.has(m.scene)) { unplaced.push(file); continue; }
            place(file, m.scene, `  (heard ${(m.cover * 100).toFixed(0)}% of scene ${m.scene}'s words)`);
        }
        // Whatever is left takes the remaining slots. This is placement, not
        // identification, and it is logged as such.
        for (const file of unplaced) {
            const free = slots.find(n => !claimed.has(n));
            if (free === undefined) { log(`   ⚠️  ${file} has no free scene slot - left in ${scratch}`); continue; }
            if (heard.ok) log(`   ⚠️  ${file} could not be identified - placed in the next free slot`);
            place(file, free, heard.ok ? '  (NOT identified - check this one)' : '');
        }

        const empty = slots.filter(n => !claimed.has(n));
        if (empty.length) log(`   ⚠️  scene slot(s) ${empty.join(', ')} stayed empty.`);
        if (!heard.ok) {
            log(`   ⚠️  the clips could not be ordered by ear (${heard.note}).`);
            log('   ⚠️  They are in output/ in the order Flow wrote them, which is NOT story order.');
            log(`   ⚠️  Raw export kept in ${scratch} - order it by hand before using these files.`);
        } else {
            log(`   ℹ️  Raw export and its transcripts kept in ${scratch}`);
        }
        return results;
    }

    // Which clip is which scene, by listening to them. Runs the already-tested
    // order_clips_by_dialogue.js as a subprocess: it transcribes each clip
    // locally (whisper - no API key, nothing leaves the machine) and matches it
    // to the scene whose words it speaks. Never throws: a failure comes back as
    // ok:false so the caller can decline to guess instead of producing an order
    // that merely looks plausible.
    orderClipsByEar(clipsDir) {
        const tool = path.join(__dirname, 'order_clips_by_dialogue.js');
        if (!fs.existsSync(tool)) return { ok: false, byFile: {}, note: 'order_clips_by_dialogue.js not found' };
        let out = '';
        try {
            out = execFileSync(process.execPath,
                [tool, this.jsonFilePath, '--clips', clipsDir, '--write'],
                { encoding: 'utf8', timeout: 30 * 60 * 1000 });
        } catch (e) {
            const text = String((e && (e.stdout || e.message)) || e);
            return { ok: false, byFile: {}, note: text.trim().split('\n').slice(-2).join(' ').slice(0, 200) };
        }
        // Only the lines that carry a decision - the transcript noise and the
        // per-clip table are useful once, not on every run.
        for (const l of out.split('\n')) {
            if (/^\s+scene\s+(\d+|--)/.test(l) || /^(Resolved|Story order|WARNING)/.test(l.trim())) {
                log(`   ${l.trim()}`);
            }
        }
        let man = null;
        try { man = JSON.parse(fs.readFileSync(path.join(clipsDir, 'manifest.json'), 'utf8')); } catch (e) { man = null; }
        const byFile = {};
        for (const c of (man && man.clips) || []) {
            if (c && c.file) byFile[c.file] = { scene: c.matched_scene, cover: c.match_cover };
        }
        if (!Object.keys(byFile).length) return { ok: false, byFile: {}, note: 'no manifest was written' };
        return { ok: true, byFile, note: null };
    }

    splitIntoScenes(fullFile) {
        banner('✂️  SPLITTING WITH FFMPEG');
        fs.mkdirSync(this.outputDir, { recursive: true });
        const results = [];
        // Offsets are this timeline's own positions: in a fresh-project
        // block (story continued under another account) scene 9 is clip 1
        // HERE, so it sits at 0s, not 64s.
        this.okScenes.forEach((n, i) => {
            const out = path.join(this.outputDir, `scene-${String(n).padStart(2, '0')}.mp4`);
            const ss = i * CONFIG.SCENE_SECONDS;
            try {
                execFileSync('ffmpeg', ['-y', '-ss', String(ss), '-t', String(CONFIG.SCENE_SECONDS),
                    '-i', fullFile, '-c:v', 'libx264', '-c:a', 'aac', out], { stdio: 'pipe', timeout: 300000 });
                log(`   ✅ scene-${String(n).padStart(2, '0')}.mp4 (${ss}s - ${ss + CONFIG.SCENE_SECONDS}s)`);
                results.push(out);
            } catch (e) {
                log(`   ❌ ffmpeg failed for scene ${n}: ${String(e.message).slice(0, 120)}`);
            }
        });
        return results;
    }

    // ── per-scene processing ──────────────────────────────────────
    async processScene(scene, index) {
        const sceneNum = index + 1;
        banner(`📍 SCENE ${sceneNum}/${this.scenes.length}: ${scene.scene_title || `Scene ${sceneNum}`}`);
        log(`⏱️  ${new Date().toLocaleTimeString()} | ${scene.scene_builder_action || (sceneNum === 1 ? 'text_to_video' : 'extend')}`);
        if (scene.script_line) log(`📝 "${scene.script_line.slice(0, 120)}..."`);

        await this.checkPause();

        try {
            // A fresh-project block starts its FIRST scene through the
            // project-grid path (text-to-video), whatever its number -
            // there is no editor or timeline to extend yet.
            const startOnGrid = sceneNum === 1
                || (this.freshProject && sceneNum === this.fromScene && !this._editorSeen);
            if (startOnGrid) {
                await this.gotoProject();
                await this.prepareScene1(scene);
                this.okScenes.push(sceneNum);
                this._countClip();
            } else {
                await this.ensureEditor();
                await this.doExtendScene(scene, sceneNum);
            }
        } catch (e) {
            const msg = e.message || String(e);
            // A drained account cannot make the remaining scenes either -
            // bubble up so run() can export what exists and hand over.
            if (/CREDITS_EXHAUSTED/.test(msg)) throw e;
            log(`\n   SCENE ${sceneNum} attempt failed: ${msg}`);
            // Rethrow and let processSceneWithRetry decide whether this was
            // the last attempt. Recording the failure here would leave a note
            // behind for a scene that a retry then goes on to succeed on.
            throw e;
        }
        await wait(2000);
    }

    // Runs one scene, retrying a failure before giving up on it.
    //
    // This retry existed before but could never fire: processScene swallowed
    // its own errors and carried on, so the catch below was unreachable and
    // every failure cost a scene permanently. processScene now rethrows and
    // the decision to continue belongs here.
    async processSceneWithRetry(scene, index) {
        const sceneNum = index + 1;
        const maxAttempts = CONFIG.sceneRetries + 1;
        let lastMsg = '';
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this.processScene(scene, index);
                if (attempt > 1) log(`   Scene ${sceneNum} succeeded on attempt ${attempt}`);
                return true;
            } catch (e) {
                const msg = e.message || String(e);
                if (/CREDITS_EXHAUSTED/.test(msg)) throw e;
                lastMsg = msg;
                // These failures happen before a generation was safely
                // submitted. Repeating clicks cannot repair a missing asset or
                // an unconfirmed submit and can hit controls after the picker
                // reflows, so stop this scene immediately.
                if (/not all required ingredients|prompt was not written|Start generation|not submitted|timeline has|could not select completed clip/i.test(msg)) break;
                if (attempt >= maxAttempts) break;

                // Jittered backoff. A tight retry loop is exactly the shape
                // Flow throttles, and a fixed delay lines every retry up
                // against the same queue slot - the spread breaks that up.
                const delay = Math.round(
                    CONFIG.retryBaseMs * Math.pow(2, attempt - 1) * (0.7 + Math.random() * 0.6));
                log(`   RETRY ${attempt}/${maxAttempts - 1} for scene ${sceneNum} in `
                    + `${(delay / 1000).toFixed(1)}s - ${msg}`);
                await wait(delay);
                // Clear whatever the failure left on screen first, or the
                // retry walks straight back into the same wall.
                await this.healStalled(`retry ${attempt} of scene ${sceneNum}`, true);
            }
        }
        log(`   Scene ${sceneNum} failed - STOPPING before any later prompt is added.`);
        await this.logFailedPrompt(sceneNum, lastMsg, scene.veo3_prompt, maxAttempts);
        throw new Error(`SEQUENCE_STOP at scene ${sceneNum}: ${lastMsg}`);
    }

    async askResumeOption() {
        console.log(`
${'='.repeat(70)}
🔄 WHERE DO YOU WANT TO START?
${'='.repeat(70)}
  1. Fresh (scene 1 setup in browser)
  2. Resume from a scene (clips already on the timeline)
`);
        const a = await this.waitForUserInput('Select (1/2): ');
        if (a === '2') {
            const b = await this.waitForUserInput('Start from scene number: ');
            this.fromScene = Math.max(2, parseInt(b, 10) || 2);
            log(`✅ Resuming from scene ${this.fromScene} (editor must be open)`);
        }
    }

    // ── main ──────────────────────────────────────────────────────
    async exportAndFinish() {
        const ex = await this.exportSceneVideo();
        const parts = ex.files.length === 1
            ? this.splitIntoScenes(ex.files[0])
            : await this.collectPerClipExport(ex.files);
        log(`DONE: ${parts.length}/${this.okScenes.length} scene files in ${this.outputDir}`);
        if (this.opts.join) {
            if (this.sequenceSuspect || parts.length !== this.okScenes.length || !parts.length ||
                this.okScenes.length !== (this.freshProject ? this.toScene - this.fromScene + 1 : this.toScene)) {
                throw Error('Cannot join an incomplete export or an uncertain scene order.');
            }
            execFileSync(process.execPath, [path.join(__dirname, 'join_clips.js'), this.outputDir,
                '--order', parts.map(p => path.basename(p)).sort().join(','),
                '--out', path.join(path.dirname(this.jsonFilePath), 'ingredients_final.mp4')],
                { stdio: 'inherit', timeout: 1800000 });
        }
        return parts;
    }

    async run() {
        banner('🎬 VEO3 FLOW NEW-UI ENGINE');
        await this.loadScenes();
        await this.initializeFailedPromptsLog();
        await this.connect();

        if (this.genRefs || this.opts.newProject || this.freshProject) {
            banner('REFERENCE IMAGES - PROJECT HOME');
            await require('./ingredients_setup').prepareReferences(this, { log });
        }
        if (this.opts.refsOnly) {
            log('Phase 1 complete. No video clips were submitted.');
            await this.browser.disconnect();
            return;
        }
        if (this.opts.exportOnly) {
            if (this.projectUrl && !this.page.url().startsWith(require('./flow_project').normalizeProjectUrl(this.projectUrl))) {
                await this.page.goto(require('./flow_project').normalizeProjectUrl(this.projectUrl), { waitUntil: 'domcontentloaded' });
            }
            await this.ensureEditor();
            this.okScenes = Array.from({ length: this.toScene }, (_, i) => i + 1);
            await this.exportAndFinish();
            await this.browser.disconnect();
            return;
        }

        // allow CLI range override after load
        if (!this.opts.toScene) this.toScene = this.scenes.length;
        if (this.fromScene > 1) {
            log(`▶️  Resume mode: scenes ${this.fromScene}-${this.toScene}`);
            if (!this.freshProject) {
                this.okScenes = Array.from({ length: this.fromScene - 1 }, (_, i) => i + 1);
                await this.prepareExistingTimelineResume();
            }
        }

        let creditsOut = false;
        try {
            for (let i = this.fromScene - 1; i < this.toScene; i++) {
                await this.processSceneWithRetry(this.scenes[i], i);
                await this.checkPause();
            }
        } catch (e) {
            // Account drained mid-story: not fatal - fall through so the
            // clips that DID land get exported, then signal the caller.
            if (!/CREDITS_EXHAUSTED/.test(e.message || String(e))) throw e;
            creditsOut = true;
        }

        const failed = [];
        for (let n = this.fromScene; n <= this.toScene; n++) {
            if (!this.okScenes.includes(n)) failed.push(n);
        }
        this.failedScenes = failed;
        if (failed.length) {
            log(`⚠️  Scenes missing from timeline: ${failed.join(', ')}`);
            log('   Re-run with --from/--to for just those scenes before exporting.');
        }

        if (this.sequenceSuspect) {
            banner('WARNING: CLIP ORDER MAY BE WRONG');
            console.log('One or more extends did not add exactly one clip in the expected place,');
            console.log('or a newly generated clip could not be confirmed as selected.');
            console.log('WATCH THE CLIPS IN FLOW ORDER BEFORE YOU USE THESE FILES - the split below');
            console.log('will happily cut a scrambled timeline into scene-01.mp4, scene-02.mp4, ...');
        }

        if (this.okScenes.length >= 1 && this.opts.download !== false) {
            try {
                await this.exportAndFinish();
            } catch (e) {
                if (!creditsOut) throw e;
                log(`Partial export/join could not complete: ${e.message}. Preserving the account-rotation signal.`);
            }
        } else {
            log(this.okScenes.length ? 'Download disabled; clips remain in Flow.' : 'No scenes succeeded - nothing to export.');
        }

        this.creditsExhausted = creditsOut;
        this.browser && this.browser.disconnect();
    }
}

// ────────────────────────────── CLI
function parseArgs(argv) {
    const opts = { _: [] };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--project-url') opts.projectUrl = argv[++i];
        else if (a === '--from') opts.fromScene = parseInt(argv[++i], 10);
        else if (a === '--to') opts.toScene = parseInt(argv[++i], 10);
        else if (a === '--skip-refs') opts.skipRefs = true;
        else if (a === '--no-voice') opts.noVoice = true;
        else if (a === '--refs-on-clip1') opts.refsOnClip1 = true;
        else if (a === '--gen-refs') opts.genRefs = true;
        else if (a === '--auto-start') opts.autoStart = true;
        else if (a === '--refs-only') { opts.refsOnly = true; opts.genRefs = true; }
        else if (a === '--no-upload-refs') opts.noUploadRefs = true;
        else if (a === '--new-project') opts.newProject = true;
        else if (a === '--video-model') opts.videoModel = argv[++i];
        else if (a === '--aspect') opts.aspect = argv[++i];
        else if (a === '--no-download') opts.download = false;
        else if (a === '--join') opts.join = true;
        else if (a === '--export-only') opts.exportOnly = true;
        else if (a === '--extend-model') opts.extendModel = argv[++i];
        else if (a === '--cdp') opts.cdp = `http://127.0.0.1:${argv[++i]}`;
        else if (a === '--account') opts.account = argv[++i];
        else if (a === '--fresh-project') opts.freshProject = true;
        else opts._.push(a);
    }
    if (opts.join) opts.download = true;
    return opts;
}

// Exported so the watchdog and retry logic can be driven against a stub page
// in tests. A direct `node veo3_flow_new_ui.js ...` still runs the CLI below.
module.exports = { Veo3FlowNewUI, CONFIG, mp4sUnder, flowClipKey, flowClipOrder, parseArgs };

if (require.main === module) (async () => {
    const opts = parseArgs(process.argv);
    if (!opts._.length) {
        console.log('Usage: node veo3_flow_new_ui.js <story.json> [--project-url URL] [--from N] [--to N] [--skip-refs] [--refs-on-clip1] [--gen-refs] [--no-voice] [--cdp 9222] [--account X] [--fresh-project]');
        process.exit(1);
    }
    const engine = new Veo3FlowNewUI(opts._[0], opts);
    if (opts.fromScene === undefined) {
        await engine.askResumeOption();
    }
    try {
        await engine.run();
    } catch (e) {
        console.error(`\n❌ FATAL: ${e.message}`);
        process.exit(1);
    }
    if (engine.creditsExhausted) {
        // Sentinel the GUI parses to rotate accounts. Exit code 3 = the
        // signed-in account's monthly Veo credits are spent.
        const last = engine.okScenes.length ? Math.max(...engine.okScenes) : (engine.fromScene - 1);
        console.log(`CREDITS_EXHAUSTED after_scene=${last} account=${engine.accountLabel || ''}`);
        console.log(`This account's monthly Veo credits are spent.`);
        console.log(`The story can continue on the next account from scene ${last + 1} (fresh project).`);
        process.exit(3);
    }
    process.exit((engine.failedScenes && engine.failedScenes.length) || (opts.autoStart && engine.sequenceSuspect) ? 2 : 0);
})();

