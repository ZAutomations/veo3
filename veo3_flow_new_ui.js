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
 *             -> "Start generation" -> wait for timeline to grow by 8s
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
    // Model used for every extend. The plan only exposes the lower-priority
    // queue, so the entry reads "Veo 3.1 - Lite [Lower Priority]". Matching
    // falls back to any "Extend (Veo ...)" entry, so a plan change can't stall
    // a run - it just logs which suffix it actually picked.
    EXTEND_MODEL: 'Veo 3.1 - Lite [Lower Priority]',
    DOWNLOADS_DIR: path.join(os.homedir(), 'Downloads'),
    OUTPUT_DIR: null,         // set from story dir
};

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ logging helpers
let LOG_T0 = Date.now();
function ts() {
    const d = new Date();
    return d.toTimeString().slice(0, 8);
}
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function banner(msg) {
    console.log(`\n${'='.repeat(70)}\n${msg}\n${'='.repeat(70)}`);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ sendkeys fallback for native dialogs
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
        log(`   âš ï¸  SendKeys fallback failed: ${e.message.slice(0, 100)}`);
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ dedicated profile (the "built browser")
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
        log(`   ðŸŒ± Seeding dedicated profile from real "${profile}" (one-time)...`);
        fs.mkdirSync(path.join(profileDir, profile), { recursive: true });
        copyDirResilient(profileSource, path.join(profileDir, profile));
        try { fs.copyFileSync(localStateSrc, path.join(profileDir, 'Local State')); } catch {}
        makeCleanProfile(profileDir, profile);
        log('   âœ… Dedicated profile ready (Flow login included)');
    } else {
        log('   âœ… Using the built automation browser profile (login persisted)');
    }
    return profileDir;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ engine
class Veo3FlowNewUI {
    constructor(jsonFilePath, opts = {}) {
        this.jsonFilePath = path.resolve(jsonFilePath);
        this.opts = opts;
        this.browser = null;
        this.page = null;
        this.scenes = [];
        this.characterReferences = {};
        this.projectUrl = opts.projectUrl || '';
        this.fromScene = opts.fromScene || 1;
        this.toScene = opts.toScene || 0; // 0 = all
        this.skipRefs = !!opts.skipRefs;
        this.cdpUrl = opts.cdp || CONFIG.CDP_URL;
        // Multi-account credit pool (account_manager.js): when set, the
        // engine runs on that account's own Chrome profile and counts its
        // clips. freshProject starts a NEW project on the grid - used when
        // a story continues under the next account (projects are
        // per-account, so the old project cannot be extended there).
        this.accountLabel = opts.account || '';
        this.freshProject = !!opts.freshProject;
        this._editorSeen = false;
        // Which model the extends use. Plans differ in what they expose here,
        // so this is overridable at runtime instead of baked in.
        this.extendModel = opts.extendModel || CONFIG.EXTEND_MODEL;
        this.okScenes = []; // scene numbers that exist on the timeline
        this.sequenceSuspect = false; // set when a clip may have landed out of order

        const jsonDir = path.dirname(this.jsonFilePath);
        const jsonName = path.basename(this.jsonFilePath, '.json');
        this.storyDir = jsonDir;
        this.outputDir = path.join(jsonDir, 'output');
        const logsDir = path.join(jsonDir, 'logs');
        this.failedPromptsLogPath = path.join(logsDir, `${jsonName}_FAILED.txt`);

        // pause/resume
        this.isPaused = false;
        this.setupPauseListener();
    }

    setupPauseListener() {
        if (process.stdin.isTTY) {
            try { process.stdin.setRawMode(true); } catch {}
        }
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (key) => {
            if (key === '\u0003') { log('ðŸ›‘ Ctrl+C - exiting...'); process.exit(); }
            const k = key.toLowerCase().trim();
            if ((k === 'p' || k === 'r')) {
                this.isPaused = !this.isPaused;
                log(this.isPaused ? 'â¸ï¸  PAUSED - press P or R to resume...' : 'â–¶ï¸  RESUMED');
            }
        });
        log('ðŸ’¡ TIP: press P to pause/resume, Ctrl+C to exit');
    }

    async checkPause() {
        while (this.isPaused) await wait(500);
    }

    async waitForUserInput(message) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise(res => rl.question(message, a => { rl.close(); res(a.trim()); }));
    }

    // â”€â”€ story loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async loadScenes() {
        log(`ðŸ“‚ Loading scenes: ${this.jsonFilePath}`);
        const data = JSON.parse(await fsp.readFile(this.jsonFilePath, 'utf-8'));
        if (!data.scenes || !Array.isArray(data.scenes)) {
            throw new Error('Invalid JSON - missing "scenes" array');
        }
        this.scenes = data.scenes;
        this.characterReferences = data.character_references || data.characterReferences || {};
        if (!this.projectUrl && data.project_url) this.projectUrl = data.project_url;
        if (!this.toScene || this.toScene > this.scenes.length) this.toScene = this.scenes.length;
        log(`âœ… ${this.scenes.length} scenes loaded | range ${this.fromScene}-${this.toScene} | skipRefs=${this.skipRefs}`);
        for (const [name, p] of Object.entries(this.characterReferences)) {
            log(`   ðŸ§‘ ${name}: ${p}`);
        }
    }

    resolveRefPath(refPath) {
        const jsonDir = path.dirname(this.jsonFilePath);
        let p = path.resolve(jsonDir, refPath);
        if (fs.existsSync(p)) return p;
        for (const ext of ['.jpg', '.jpeg', '.png']) {
            const t = p.replace(/\.(jpg|jpeg|png)$/i, ext);
            if (fs.existsSync(t)) return t;
        }
        return null;
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
            log(`   ðŸ“ Logged to ${path.basename(this.failedPromptsLogPath)}`);
        } catch {}
    }

    // â”€â”€ browser connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Uses the dedicated "built" browser: system Chrome binary + persistent
    // cloned profile (flow login included) + CDP port. Same as the MCP setup.
    async connect() {
        banner('ðŸš€ CONNECTING THE AUTOMATION BROWSER');
        const port = this.cdpUrl.replace('http://127.0.0.1:', '');
        let connected = false;
        for (let i = 0; i < 3; i++) {
            try {
                this.browser = await puppeteer.connect({ browserURL: this.cdpUrl, defaultViewport: null });
                connected = true;
                break;
            } catch {
                log(`âš ï¸  No automation Chrome on CDP port ${port} (attempt ${i + 1}/3)`);
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
                    log('   â³ Starting Chrome with the dedicated profile...');
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
        log(`âœ… Automation browser attached (CDP ${this.cdpUrl}, profile: ${this.accountLabel || CONFIG.CHROME_PROFILE})`);

        const pages = await this.browser.pages();
        this.page = pages.find(p => (p.url() || '').includes('flow.google.com')) || pages[pages.length - 1] || await this.browser.newPage();
        this.page.setDefaultTimeout(120000);
        this.page.setDefaultNavigationTimeout(120000);
        log(`âœ… Page: ${this.page.url().slice(0, 90)}`);
    }

    async gotoProject() {
        // A story continuing under a new account starts a NEW project on
        // the grid - the previous project belongs to that account's login
        // and cannot be opened or extended from here.
        if (this.freshProject) {
            log('Fresh project: starting on the Flow project grid');
            await this.page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 120000 });
            await wait(8000);
            return;
        }
        if (!this.projectUrl) {
            const a = await this.waitForUserInput('ðŸŒ Enter the Flow PROJECT url (https://flow.google.com/project/...): ');
            this.projectUrl = a;
        }
        const cur = this.page.url() || '';
        if (this.isEditorUrl(cur)) {
            log('âœ… Already in scene editor');
            return;
        }
        log(`ðŸŒ Opening project: ${this.projectUrl}`);
        await this.page.goto(this.projectUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await wait(8000);
    }

    isEditorUrl(url) {
        return /\/project\/[0-9a-f-]+\/(scene|edit)\//i.test(url || '');
    }

    // â”€â”€ generic page helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async evalJs(fn, ...args) {
        try { return await this.page.evaluate(fn, ...args); }
        catch (e) { return { __error: e.message.slice(0, 150) }; }
    }

    // Read timeline duration from readouts like "00:08:00" (MM:SS:FF) or
    // "00:00:08:00" (HH:MM:SS:FF). Returns the max in SECONDS.
    async getTimelineSeconds() {
        const r = await this.evalJs(() => {
            // Preferred: the timeline's TOTAL duration readout (MM:SS:FF).
            // The playhead's own .timecode-value is always smaller, so this is
            // unambiguous where the old max-scan-over-all-readouts was not.
            const dur = document.querySelector('.duration-timecode-value');
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
        });
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

    // â”€â”€ prompt typing (ProseMirror editor in new UI) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async typePrompt(prompt) {
        const ok = await this.evalJs((p) => {
            // The prompt box is a ProseMirror editor; its placeholder span reads
            // "What happens next?" / "What do you want to create?" / "Describe how to editâ€¦"
            let el = document.querySelector('.ProseMirror[contenteditable="true"]');
            if (!el) {
                const boxes = [...document.querySelectorAll('[contenteditable="true"]')];
                el = boxes.find(e => /What do you want to create|What happens next|Describe how to edit/.test(e.innerText || ''))
                     || boxes[boxes.length - 1];
            }
            if (!el) return false;
            el.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, p);
            return true;
        }, prompt);
        if (!ok) throw new Error('prompt box not found');
        await wait(500);
        log('   âœ… Prompt entered');
    }

    // Definitive "extend armed" signal: the ProseMirror placeholder span appears
    extendArmedJs() {
        return (() => {
            const ph = document.querySelector('.prosemirror-placeholder');
            if (ph && /What happens next/i.test(ph.textContent || '')) return true;
            const pm = document.querySelector('.ProseMirror');
            if (pm && /What happens next/i.test(pm.textContent || '')) return true;
            return /exit extend mode/i.test(document.body.innerText || '');
        })();
    }

    // â”€â”€ reference upload + attach as ingredient â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Full flow: click + (add) -> pick existing asset OR "Upload media" ->
    // select the ref in the picker -> "Add to prompt". Uploading alone does
    // NOT attach the ref - without "Add to prompt" the generation ignores it.
    async uploadRef(filePath) {
        const base = path.basename(filePath).replace(/\.[^.]+$/, '');
        log(`   ðŸ“¤ Uploading + attaching ref: ${path.basename(filePath)}`);

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
            if (!menuOpen) { log(`   âš ï¸  no add (+) button (attempt ${attempt})`); await wait(2500); }
            else await wait(1500);
        }
        if (!menuOpen) { log('   âš ï¸  add menu never opened'); return false; }

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
            await this.evalJs(() => {
                const bd = document.querySelector('.cdk-overlay-backdrop');
                if (bd) bd.click();
            });
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
        const names = scene.characters && scene.characters.length ? scene.characters : Object.keys(this.characterReferences);
        for (const name of names) {
            const p = this.characterReferences[name];
            const abs = p ? this.resolveRefPath(p) : null;
            if (!abs) { log(`   âš ï¸  no ref file for "${name}"`); continue; }
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
        for (let attempt = 1; attempt <= 4; attempt++) {
            const opened = await this.evalJs(() => {
                const b = document.querySelector('button[aria-label="Add ingredients to the prompt box"]')
                       || [...document.querySelectorAll('button')].find(x =>
                            (x.getAttribute('aria-label') || '').includes('Add ingredients'));
                if (!b) return false;
                b.click();
                return true;
            });
            if (opened) {
                await wait(1500);
                const ready = await this.evalJs(() =>
                    !!document.querySelector('cdk-virtual-scroll-viewport[aria-label="Asset list"]'));
                if (ready) return true;
                log(`   ⚠️  + clicked but asset list not rendered (attempt ${attempt}/4)`);
            } else {
                log(`   ⚠️  no "Add ingredients to the prompt box" button (attempt ${attempt}/4)`);
            }
            await wait(2000);
        }
        return false;
    }

    // Find one sheet by filename inside the picker. The list is virtualised, so
    // walk it in viewport-sized steps if the target is not rendered yet.
    async findAssetItem(name) {
        for (let pass = 0; pass < 12; pass++) {
            const state = await this.evalJs((n) => {
                const vp = document.querySelector('cdk-virtual-scroll-viewport[aria-label="Asset list"]')
                        || document.querySelector('.asset-list-viewport');
                if (!vp) return { state: 'no-picker' };
                const items = [...vp.querySelectorAll('button.asset-item')];
                const hit = items.find(b => {
                    const t = b.querySelector('.asset-title');
                    return t && new RegExp(n, 'i').test(t.textContent.trim());
                });
                if (hit) {
                    if (hit.getAttribute('aria-selected') === 'true') return { state: 'already' };
                    hit.click();
                    return { state: 'clicked' };
                }
                // not rendered yet - nudge the virtual scroller and retry
                const before = vp.scrollTop;
                vp.scrollTop = before + Math.max(40, vp.clientHeight * 0.9);
                return { state: 'scrolled', atEnd: vp.scrollTop === before, count: items.length };
            }, name);
            if (state.state === 'clicked' || state.state === 'already') return state.state;
            if (state.state === 'no-picker') return state.state;
            if (state.atEnd) return `not-found (${state.count} items visible)`;
            await wait(500);
        }
        return 'not-found (scroll exhausted)';
    }

    async selectRefsForScene(scene, sceneNum) {
        if (this.skipRefs) { log('   (refs skipped - ingredients already attached)'); return false; }
        const names = (scene.characters && scene.characters.length)
            ? scene.characters
            : Object.keys(this.characterReferences);
        if (!names.length) { log('   (no characters listed for this scene)'); return false; }

        const wanted = names
            .map(n => this.characterReferences[n])
            .filter(Boolean)
            .map(p => path.basename(p).replace(/\.[^.]+$/, ''));
        if (!wanted.length) { log('   (no ref files resolved for this scene)'); return false; }

        log(`   🧩 Attaching ingredients for scene ${sceneNum}: ${wanted.join(', ')}`);
        if (!await this.openAssetPicker()) {
            log('   ⚠️  ingredient picker never opened - refs NOT attached');
            return false;
        }

        let attached = 0;
        for (const name of wanted) {
            const r = await this.findAssetItem(name);
            log(`      ${name}: ${r}`);
            if (r === 'clicked' || r === 'already') attached++;
            await wait(600);
        }

        if (!attached) {
            log('   ⚠️  none of the ingredient sheets were found in the picker');
            await this.evalJs(() => {
                const bd = document.querySelector('.cdk-overlay-backdrop');
                if (bd) bd.click();
            });
            return false;
        }

        // one "Add to prompt" applies to every ticked asset
        let added = false;
        for (let i = 0; i < 10 && !added; i++) {
            added = await this.evalJs(() => {
                const ov = document.querySelector('.cdk-overlay-container');
                const scope = ov && ov.innerText ? ov : document;
                const btn = [...scope.querySelectorAll('button')]
                    .find(x => /add to prompt/i.test(x.innerText || x.getAttribute('aria-label') || ''));
                if (!btn || btn.disabled) return false;
                btn.click();
                return true;
            });
            if (!added) await wait(1000);
        }
        log(added ? `   ✅ ${attached}/${wanted.length} ingredient(s) attached to prompt`
                  : '   ⚠️  "Add to prompt" never clicked - refs may not be attached');
        await wait(2000);
        return added;
    }

    // â”€â”€ scene 1 (project grid, text-to-video) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async prepareScene1(scene) {
        banner(`ðŸŽ¬ SCENE 1 SETUP: ${scene.scene_title || 'Scene 1'}`);
        // prompt box must be the "What do you want to create?" one
        await this.uploadStoryRefs(scene);
        await this.typePrompt(scene.veo3_prompt);
        log('');
        log('   ðŸ‘† IN BROWSER: pick model / aspect ratio, then click "Start generation" (arrow)');
        log('   â³ Waiting for generation to start and finish... (max 12 min)');
        const deadline = Date.now() + 720000;
        let sawGenerating = false;
        while (Date.now() < deadline) {
            await wait(CONFIG.CHECK_INTERVAL);
            const st = await this.evalJs(() => ({
                url: location.href,
                stop: [...document.querySelectorAll('button')].some(b => (b.innerText || '').trim() === 'stop'),
                failed: [...document.querySelectorAll('*')].some(e => {
                    const t = (e.textContent || '').trim();
                    const r = e.getBoundingClientRect();
                    return e.children.length < 3 && r.width > 0 &&
                        /sorry, this video failed|something went wrong|failed to generate/i.test(t) && t.length < 120;
                }),
            }));
            if (st.__error) continue;
            if (await this.checkCreditsOut()) throw new Error('CREDITS_EXHAUSTED');
            if (st.failed) throw new Error('Scene 1 generation FAILED in browser');
            if (st.stop) { if (!sawGenerating) { sawGenerating = true; log('   ðŸ”„ Generating...'); } continue; }
            if (sawGenerating || this.isEditorUrl(st.url)) {
                // generation likely done - look for the clip tile / editor
                if (this.isEditorUrl(st.url)) {
                    log('   EDITOR-OPEN');
                    await this.waitForEditorReady();
                    await this.clickNewestClip();
                    return;
                }
                // click newest tile to enter editor
                const clicked = await this.evalJs(() => {
                    const tiles = [...document.querySelectorAll('flow-video-tile')];
                    if (!tiles.length) return false;
                    const t = tiles[tiles.length - 1];
                    const el = t.querySelector('img, video') || t;
                    el.click();
                    return true;
                });
                if (clicked) {
                    await wait(8000);
                    if (this.isEditorUrl(this.page.url())) {
                        log('   âœ… Clip ready, editor open');
                        await this.waitForEditorReady();
                        await this.clickNewestClip();
                        return;
                    }
                }
            }
        }
        throw new Error('Scene 1: timed out waiting for clip/editor');
    }

    // â”€â”€ scenes 2+ (extend in editor) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async ensureEditor() {
        if (this.isEditorUrl(this.page.url())) return this.waitForEditorReady();
        // Poll for up to 60s - the editor may open in any tab of the
        // AUTOMATION browser (not your personal Chrome!).
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            const pages = await this.browser.pages();
            const ep = pages.find(p => this.isEditorUrl(p.url()));
            if (ep) { this.page = ep; log('✅ Found editor tab'); return this.waitForEditorReady(); }
            await wait(3000);
        }
        // Self-recover: if we are on the project grid, click the newest tile
        const urls = (await this.browser.pages()).map(p => (p.url() || '').slice(0, 80));
        log(`   ⚠️  No editor tab. Open tabs: ${JSON.stringify(urls)}`);
        if (/flow\.google\.com\/project/.test(this.page.url() || '') && !/\/(scene|edit)\//.test(this.page.url())) {
            log('   🖱️  Clicking newest clip tile to open the editor...');
            const clicked = await this.evalJs(() => {
                const tiles = [...document.querySelectorAll('flow-video-tile')];
                if (!tiles.length) return false;
                const el = tiles[tiles.length - 1].querySelector('img, video') || tiles[tiles.length - 1];
                el.click();
                return true;
            });
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

    // The editor takes 30-60s to hydrate (canvas, "Add clip" button). Wait for it.
    async waitForEditorReady(maxWaitMs = 120000) {
        this._editorSeen = true; // grid and resume paths both end here
        log('   â³ Waiting for editor to fully load (Add clip button)...');
        const deadline = Date.now() + maxWaitMs;
        while (Date.now() < deadline) {
            const ready = await this.evalJs(() => ({
                addClip: [...document.querySelectorAll('button')]
                    .some(b => (b.getAttribute('aria-label') || '') === 'Add clip'),
                armed: (() => {
                    const ph = document.querySelector('.prosemirror-placeholder');
                    return (ph && /What happens next/i.test(ph.textContent || '')) ||
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
            }));
            if (!ready.__error && (ready.addClip || ready.armed)) {
                log(`   âœ… Editor ready (timeline ~${ready.secs}s)`);
                return true;
            }
            await wait(4000);
        }
        throw new Error('Editor did not become ready (no Add clip button within 2 min)');
    }

    async armExtend(sceneNum) {
        log(`   ðŸ”— Arming EXTEND mode for scene ${sceneNum}...`);
        // if already armed ("What happens next?" placeholder), reuse
        const armed = await this.evalJs(() => {
            const ph = document.querySelector('.prosemirror-placeholder');
            if (ph && /What happens next/i.test(ph.textContent || '')) return true;
            const pm = document.querySelector('.ProseMirror');
            if (pm && /What happens next/i.test(pm.textContent || '')) return true;
            return /exit extend mode/i.test(document.body.innerText || '');
        });
        if (armed) { log('   âœ… Extend mode already armed'); return; }

        for (let attempt = 1; attempt <= 12; attempt++) {
            const ok = await this.evalJs(() => {
                const addClip = [...document.querySelectorAll('button')]
                    .find(b => (b.getAttribute('aria-label') || '') === 'Add clip');
                if (!addClip) return { step: 'no Add clip' };
                addClip.click();
                return { step: 'clicked' };
            });
            if (ok.__error || !ok || ok.step !== 'clicked') {
                log(`   âš ï¸  attempt ${attempt}/12: no Add clip button (${(ok && ok.step) || 'err'})`);
                await wait(5000);
                continue;
            }
            await wait(2500);
            const picked = await this.evalJs((wantModel) => {
                const ov = document.querySelector('.cdk-overlay-container');
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
                const pref = items.find(x => labelOf(x).includes(wantModel));
                const item = pref || items[0];
                item.click();
                return { state: 'clicked', model: labelOf(item).slice(0, 70), preferred: !!pref,
                         available: items.map(x => labelOf(x).slice(0, 70)) };
            }, this.extendModel);
            if (!picked || picked.state !== 'clicked') {
                log(`   Extend menu problem: ${picked ? picked.state : 'eval error'}`);
                if (picked && picked.__error) {
                    log(`      page error: ${picked.__error}`);
                }
                if (picked && picked.offered && picked.offered.length) {
                    log(`      menu actually contained: ${picked.offered.join(' | ')}`);
                }
            }
            if (picked && picked.state === 'clicked') {
                log(picked.preferred
                    ? `   Extend model: ${picked.model}`
                    : `   WARNING: "${this.extendModel}" not offered - using: ${picked.model}`);
                if (!picked.preferred && picked.available) {
                    log(`   Models actually offered here: ${picked.available.join(' | ')}`);
                }
                // give the editor a moment, then verify via the placeholder span
                await wait(3500);
                const verify = await this.evalJs(() => {
                    const ph = document.querySelector('.prosemirror-placeholder');
                    if (ph && /What happens next/i.test(ph.textContent || '')) return true;
                    const pm = document.querySelector('.ProseMirror');
                    if (pm && /What happens next/i.test(pm.textContent || '')) return true;
                    return /exit extend mode/i.test(document.body.innerText || '');
                });
                if (verify) { log('   âœ… Extend armed (What happens next? shown)'); return; }
                log('   âš ï¸  Extend item clicked but placeholder not confirmed - re-checking...');
                await wait(3000);
                const verify2 = await this.evalJs(() => {
                    const ph = document.querySelector('.prosemirror-placeholder');
                    if (ph && /What happens next/i.test(ph.textContent || '')) return true;
                    return /exit extend mode/i.test(document.body.innerText || '');
                });
                if (verify2) { log('   âœ… Extend armed (late confirm)'); return; }
            }
            // only close a stray overlay if NOT armed
            await this.evalJs(() => {
                const bd = document.querySelector('.cdk-overlay-backdrop');
                if (bd) bd.click();
            });
            await wait(2000);
        }
        throw new Error(`armExtend failed for scene ${sceneNum}`);
    }

    async clickStartGeneration() {
        const ok = await this.evalJs(() => {
            const btn = [...document.querySelectorAll('button')].find(b => {
                if ((b.getAttribute('aria-label') || '') === 'Start generation') return true;
                const icon = b.querySelector('mat-icon.google-symbols, .google-symbols');
                return icon && icon.textContent.trim() === 'arrow_forward';
            });
            if (!btn) return false;
            btn.click();
            return true;
        });
        if (!ok) throw new Error('Start generation (arrow_forward) button not found');
        log('   ðŸ–±ï¸  Start generation clicked');
    }

    async autoApproveCredits() {
        const clicked = await this.evalJs(() => {
            const btns = [...document.querySelectorAll('button')];
            const b = btns.find(x => /always approve/i.test(x.innerText || '')) ||
                      btns.find(x => (x.innerText || '').trim() === 'Approve');
            if (b) { b.click(); return (b.innerText || '').trim(); }
            return null;
        });
        if (clicked) { log(`   ðŸ’³ Approved credits dialog (${clicked})`); await wait(1500); }
        return !!clicked;
    }

    // Out-of-credits: Flow shows a "get more credits" style message when
    // the signed-in account's monthly Veo allowance is spent. Sniffed during
    // the generation polls so a drained account stops the run instead of
    // every remaining scene failing one by one.
    async checkCreditsOut() {
        if (this._creditsOut) return true;
        try {
            const out = await this.evalJs(() => {
                const t = (document.body && document.body.innerText) || '';
                return /out of credits|insufficient credits|no credits left|get more credits|buy more credits|run out of credits/i.test(t);
            });
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
        const n = await this.evalJs(() => document.querySelectorAll('.extend-placeholder-text').length);
        return (typeof n === 'number') ? n : 0;
    }

    // How many clips are on the timeline. This is the strongest structural
    // signal available: one completed extend must add exactly one clip.
    async countClips() {
        const n = await this.evalJs(() => document.querySelectorAll('.timeline-contents .clip').length);
        return (typeof n === 'number') ? n : 0;
    }

    async waitForExtendComplete(sceneNum, prevSeconds, slotsAfterArm) {
        // VELOCITY OF VEO 3.1 LITE: a clip typically lands in 15-60s. There is
        // NO reliable DOM signal for completion (the reserved slot's marker
        // disappears at generation START). So we use
        // the old tool's proven strategy: fixed minimum wait + error sniffing.
        const minWaitMs = 75000;   // never proceed before this
        const target = prevSeconds + CONFIG.SCENE_SECONDS - 1;
        const deadline = Date.now() + CONFIG.MAX_WAIT;

        log(`   ⏳ Waiting ${Math.round(minWaitMs / 1000)}s minimum for scene ${sceneNum} clip to generate...`);
        const minEnd = Date.now() + minWaitMs;
        let failedEarly = false;
        while (Date.now() < minEnd) {
            await wait(3000);
            const st = await this.evalJs(() => ({
                failed: /sorry, this video failed|something went wrong|failed to generate/i.test(document.body.innerText || ''),
                approve: [...document.querySelectorAll('button')]
                    .some(b => /always approve/i.test(b.innerText || '') || (b.innerText || '').trim() === 'Approve'),
            }));
            if (st.__error) continue;
            if (await this.checkCreditsOut()) throw new Error('CREDITS_EXHAUSTED');
            if (st.approve) await this.autoApproveCredits();
            if (st.failed) { failedEarly = true; break; }
        }
        if (failedEarly) throw new Error(`Scene ${sceneNum} generation FAILED (Flow error text visible)`);

        // After min wait: require the timeline to include our slot, then a
        // settling pause so the clip is fully written.
        while (Date.now() < deadline) {
            const secs = await this.getTimelineSeconds();
            if (secs >= target) {
                await wait(5000);
                log(`   ✅ Clip window complete (timeline ${secs}s)`);
                return secs;
            }
            await wait(3000);
        }
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
async doExtendScene(scene, sceneNum) {
        const prev = await this.getTimelineSeconds();
        this.clipsBeforeExtend = await this.countClips();
        log(`   📏 Timeline before: ${prev}s`);
        await this.armExtend(sceneNum);
        const slotsAfterArm = await this.countEmptySlots();
        this.clipsAfterArm = await this.countClips();
        log(`   📐 Reserved empty slots after arming: ${slotsAfterArm} | clips ${this.clipsBeforeExtend} -> ${this.clipsAfterArm}`);
        if (slotsAfterArm === 0) {
            throw new Error('no empty slot was reserved after arming - extend did not engage');
        }
        await this.typePrompt(scene.veo3_prompt);
        // Attach the reference sheets for the characters THIS scene needs, from
        // the ones already uploaded to the project (no re-upload).
        await this.selectRefsForScene(scene, sceneNum);
        await this.clickStartGeneration();
        await this.autoApproveCredits();
        const now = await this.waitForExtendComplete(sceneNum, prev, slotsAfterArm);
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
        const gained = clipsNow - this.clipsBeforeExtend;
        log(`   CLIPS: ${this.clipsBeforeExtend} -> ${this.clipsAfterArm} (after arm) -> ${clipsNow} (after gen) | timeline ${prev}s -> ${now}s`);
        if (gained !== 1) {
            log(`   WARN: expected to gain exactly 1 clip for scene ${sceneNum}, gained ${gained}.`);
            log(`   WARN: the extend may have landed in the wrong place - check scene order before exporting.`);
            this.sequenceSuspect = true;
        }
        if (clipsNow < this.clipsBeforeExtend) {
            throw new Error(
                `Scene ${sceneNum}: clip count DROPPED from ${this.clipsBeforeExtend} to ${clipsNow}. ` +
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
    async exportSceneVideo() {
        banner('â¬‡ï¸  EXPORTING FULL SCENE');
        await this.ensureEditor();
        const before = fs.existsSync(CONFIG.DOWNLOADS_DIR)
            ? fs.readdirSync(CONFIG.DOWNLOADS_DIR).filter(f => /\.mp4$/i.test(f)) : [];

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
        if (!clicked) log('   âš ï¸  no explicit download button in dialog - maybe export started directly');

        log('   â³ Waiting for the .mp4 to land in Downloads...');
        const deadline = Date.now() + 600000;
        let newFile = null;
        while (Date.now() < deadline) {
            await wait(3000);
            const now = fs.readdirSync(CONFIG.DOWNLOADS_DIR).filter(f => /\.mp4$/i.test(f));
            const fresh = now.filter(f => !before.includes(f) && !/-\d+\.part$/i.test(f));
            if (fresh.length) {
                const full = path.join(CONFIG.DOWNLOADS_DIR, fresh[0]);
                const stable = fs.statSync(full).size;
                await wait(4000);
                if (fs.statSync(full).size === stable && stable > 100000) { newFile = full; break; }
            }
        }
        if (!newFile) throw new Error('Export never produced an .mp4 in Downloads');
        log(`   âœ… Downloaded: ${newFile}`);
        return newFile;
    }

    splitIntoScenes(fullFile) {
        banner('âœ‚ï¸  SPLITTING WITH FFMPEG');
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
                log(`   âœ… scene-${String(n).padStart(2, '0')}.mp4 (${ss}s - ${ss + CONFIG.SCENE_SECONDS}s)`);
                results.push(out);
            } catch (e) {
                log(`   âŒ ffmpeg failed for scene ${n}: ${String(e.message).slice(0, 120)}`);
            }
        });
        return results;
    }

    // â”€â”€ per-scene processing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async processScene(scene, index) {
        const sceneNum = index + 1;
        banner(`ðŸ“ SCENE ${sceneNum}/${this.scenes.length}: ${scene.scene_title || `Scene ${sceneNum}`}`);
        log(`â±ï¸  ${new Date().toLocaleTimeString()} | ${scene.scene_builder_action || (sceneNum === 1 ? 'text_to_video' : 'extend')}`);
        if (scene.script_line) log(`ðŸ“ "${scene.script_line.slice(0, 120)}..."`);

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
            log(`\n   âŒ SCENE ${sceneNum} FAILED: ${msg}`);
            await this.logFailedPrompt(sceneNum, msg, scene.veo3_prompt);
            log('   â­ï¸  Continuing to next scene (story order may need a re-run of this scene)');
        }
        await wait(2000);
    }

    async processSceneWithRetry(scene, index) {
        const sceneNum = index + 1;
        const maxFullRetries = 2;
        for (let r = 0; r <= maxFullRetries; r++) {
            try {
                await this.processScene(scene, index);
                return;
            } catch (e) {
                if (r >= maxFullRetries) throw e;
                log(`   ðŸ”„ FULL RETRY ${r + 1}/${maxFullRetries} for scene ${sceneNum} after error`);
                await wait(5000);
            }
        }
    }

    async askResumeOption() {
        console.log(`
${'='.repeat(70)}
ðŸ”„ WHERE DO YOU WANT TO START?
${'='.repeat(70)}
  1. Fresh (scene 1 setup in browser)
  2. Resume from a scene (clips already on the timeline)
`);
        const a = await this.waitForUserInput('Select (1/2): ');
        if (a === '2') {
            const b = await this.waitForUserInput('Start from scene number: ');
            this.fromScene = Math.max(2, parseInt(b, 10) || 2);
            log(`âœ… Resuming from scene ${this.fromScene} (editor must be open)`);
        }
    }

    // â”€â”€ main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async run() {
        banner('ðŸŽ¬ VEO3 FLOW NEW-UI ENGINE');
        await this.loadScenes();
        await this.initializeFailedPromptsLog();
        await this.connect();

        // allow CLI range override after load
        if (!this.opts.toScene) this.toScene = this.scenes.length;
        if (this.fromScene > 1) {
            log(`â–¶ï¸  Resume mode: scenes ${this.fromScene}-${this.toScene}`);
            if (!this.freshProject) {
                this.okScenes = Array.from({ length: this.fromScene - 1 }, (_, i) => i + 1);
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
        if (failed.length) {
            log(`âš ï¸  Scenes missing from timeline: ${failed.join(', ')}`);
            log('   Re-run with --from/--to for just those scenes before exporting.');
        }

        if (this.sequenceSuspect) {
            banner('WARNING: CLIP ORDER MAY BE WRONG');
            console.log('One or more extends did not add exactly one clip in the expected place,');
            console.log('or a newly generated clip could not be confirmed as selected.');
            console.log('WATCH THE CLIPS IN FLOW ORDER BEFORE YOU USE THESE FILES - the split below');
            console.log('will happily cut a scrambled timeline into scene-01.mp4, scene-02.mp4, ...');
        }

        if (this.okScenes.length >= 1) {
            try {
                const full = await this.exportSceneVideo();
                const parts = this.splitIntoScenes(full);
                log(`\nâœ… DONE: ${parts.length}/${this.okScenes.length} scene files in ${this.outputDir}`);
            } catch (e) {
                log(`\nâš ï¸  Export/split failed: ${e.message}`);
                log('   The timeline still holds all clips - fix the issue and re-run export only.');
            }
        } else {
            log('âŒ No scenes succeeded - nothing to export.');
        }

        this.creditsExhausted = creditsOut;
        this.browser && this.browser.disconnect();
    }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ CLI
function parseArgs(argv) {
    const opts = { _: [] };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--project-url') opts.projectUrl = argv[++i];
        else if (a === '--from') opts.fromScene = parseInt(argv[++i], 10);
        else if (a === '--to') opts.toScene = parseInt(argv[++i], 10);
        else if (a === '--skip-refs') opts.skipRefs = true;
        else if (a === '--extend-model') opts.extendModel = argv[++i];
        else if (a === '--cdp') opts.cdp = `http://127.0.0.1:${argv[++i]}`;
        else if (a === '--account') opts.account = argv[++i];
        else if (a === '--fresh-project') opts.freshProject = true;
        else opts._.push(a);
    }
    return opts;
}

(async () => {
    const opts = parseArgs(process.argv);
    if (!opts._.length) {
        console.log('Usage: node veo3_flow_new_ui.js <story.json> [--project-url URL] [--from N] [--to N] [--skip-refs] [--cdp 9222] [--account X] [--fresh-project]');
        process.exit(1);
    }
    const engine = new Veo3FlowNewUI(opts._[0], opts);
    if (opts.fromScene === undefined) {
        await engine.askResumeOption();
    }
    try {
        await engine.run();
    } catch (e) {
        console.error(`\nâŒ FATAL: ${e.message}`);
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
    process.exit(0);
})();

