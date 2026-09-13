/*
 * account_manager.js - multi-account credit pool for Flow/Veo 3.
 *
 * Each Google account gets its own Chrome profile directory (signed into
 * Flow once, by hand) under %LOCALAPPDATA%\flow-profiles\<slug>. The
 * automation browser runs ONE profile at a time on the CDP port; this
 * module switches which one, and counts the clips each account has spent
 * this month so the pool can be drained one account at a time.
 *
 * Storage is accounts.json next to this file (gitignored - it holds the
 * account email addresses and never any passwords; sign-ins are typed by
 * hand into real Chrome windows).
 *
 * CLI:
 *   node account_manager.js list
 *   node account_manager.js add --label "acc 1" [--email x@gmail.com] [--max-clips 100]
 *   node account_manager.js remove --label "acc 1"
 *   node account_manager.js use --label "acc 1" [--cdp 9222]   switch the automation browser
 *   node account_manager.js count --label "acc 1"              +1 clip this month
 *   node account_manager.js next                               print next account with credits left
 *
 * Required by veo3_flow_new_ui.js (--account) and the GUI Accounts tab.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const PROFILES_ROOT = path.join(process.env.LOCALAPPDATA || '.', 'flow-profiles');
// The old single-account profile - it must be closed too when switching,
// because it holds the CDP port.
const LEGACY_PROFILE_DIR = path.join(process.env.LOCALAPPDATA || '.', 'flow-mcp-profile');

const CHROME_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '.', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];
const CHROME_EXE = CHROME_CANDIDATES.find(p => fs.existsSync(p)) || CHROME_CANDIDATES[0];

// ─── storage ────────────────────────────────────────────────────────────────

function defaultStore() { return { accounts: [], current: 0 }; }

function load() {
    try {
        const s = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
        if (Array.isArray(s.accounts)) return s;
    } catch {}
    return defaultStore();
}

function save(store) {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

function monthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Credits reset monthly - the counter resets itself the first time an
// account is touched in a new month, so nobody has to remember.
function ensureMonthly(acc) {
    const mk = monthKey();
    if (acc.clips_month !== mk) {
        acc.clips_month = mk;
        acc.clips_used = 0;
    }
    return acc;
}

function slug(label) {
    return String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'account';
}

function findAccount(store, label) {
    const want = String(label).toLowerCase();
    return store.accounts.find(a => (a.label || '').toLowerCase() === want || a.profile === want);
}

// ─── registry ops ────────────────────────────────────────────────────────────

function add(label, email, maxClips) {
    const store = load();
    if (findAccount(store, label)) throw new Error(`An account labelled "${label}" already exists.`);
    const acc = {
        label: String(label),
        email: String(email || ''),
        profile: slug(label),
        clips_month: monthKey(),
        clips_used: 0,
        max_clips: Number(maxClips) > 0 ? Number(maxClips) : 100,
        paused: false,
    };
    store.accounts.push(acc);
    if (store.accounts.length === 1) store.current = 0;
    save(store);
    return acc;
}

function remove(label) {
    const store = load();
    const i = store.accounts.findIndex(a => (a.label || '').toLowerCase() === String(label).toLowerCase());
    if (i < 0) throw new Error(`No account labelled "${label}".`);
    const [gone] = store.accounts.splice(i, 1);
    if (store.current >= store.accounts.length) store.current = Math.max(0, store.accounts.length - 1);
    save(store);
    return gone;
}

function setPaused(label, paused) {
    const store = load();
    const acc = findAccount(store, label);
    if (!acc) throw new Error(`No account labelled "${label}".`);
    acc.paused = !!paused;
    save(store);
    return acc;
}

function setMaxClips(label, maxClips) {
    const store = load();
    const acc = findAccount(store, label);
    if (!acc) throw new Error(`No account labelled "${label}".`);
    acc.max_clips = Number(maxClips) > 0 ? Number(maxClips) : acc.max_clips;
    save(store);
    return acc;
}

function currentAccount() {
    const store = load();
    const acc = store.accounts[store.current];
    return acc ? ensureMonthly(acc) : null;
}

function setCurrent(label) {
    const store = load();
    const i = store.accounts.findIndex(a => (a.label || '').toLowerCase() === String(label).toLowerCase());
    if (i < 0) throw new Error(`No account labelled "${label}".`);
    store.current = i;
    save(store);
    return store.accounts[i];
}

// Next account that still has clips left this month and is not paused.
// Starts looking AFTER the current one and wraps once; returns null when
// every account is empty or paused.
function nextAvailable() {
    const store = load();
    const n = store.accounts.length;
    if (!n) return null;
    for (let step = 1; step <= n; step++) {
        const acc = ensureMonthly(store.accounts[(store.current + step) % n]);
        if (!acc.paused && acc.clips_used < acc.max_clips) return acc;
    }
    return null;
}

function countClip(label, n) {
    const store = load();
    const acc = findAccount(store, label);
    if (!acc) return null;
    ensureMonthly(acc);
    acc.clips_used += Number(n) || 1;
    save(store);
    return acc;
}

function resetCounter(label) {
    const store = load();
    const acc = findAccount(store, label);
    if (!acc) throw new Error(`No account labelled "${label}".`);
    acc.clips_month = monthKey();
    acc.clips_used = 0;
    save(store);
    return acc;
}

function profileDir(acc) {
    return path.join(PROFILES_ROOT, acc.profile || slug(acc.label));
}

// ─── browser switching ───────────────────────────────────────────────────────

async function cdpAlive(port) {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
        return res.ok;
    } catch { return false; }
}

// Kill every Chrome that was started with one of OUR profile dirs. Only
// those - the user's personal Chrome must survive the switch.
function killAutomationChromes() {
    const ps = `
$roots = @('${PROFILES_ROOT.replace(/'/g, "''")}', '${LEGACY_PROFILE_DIR.replace(/'/g, "''")}')
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object {
  $cl = $_.CommandLine
  if (-not $cl) { return $false }
  foreach ($r in $roots) { if ($cl -like "*$r*") { return $true } }
  return $false
} | ForEach-Object { taskkill /PID $_.ProcessId /F /T 2>$null | Out-Null }`;
    try { execFileSync('powershell', ['-NoProfile', '-Command', ps], { timeout: 30000 }); } catch {}
}

// Bring the automation browser up on the given account's profile and wait
// for the CDP port to answer. First launch of a new profile opens a fresh
// Chrome - the caller/user signs that account into Flow once, by hand.
async function launchBrowser(acc, port) {
    const dir = profileDir(acc);
    fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
    spawn(CHROME_EXE, [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${dir}`,
        '--profile-directory=Default',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
        'https://flow.google.com/',
    ], { detached: true, stdio: 'ignore' }).unref();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        if (await cdpAlive(port)) return true;
        await new Promise(r => setTimeout(r, 1500));
    }
    return false;
}

// The full switch: close whatever automation browser is running, start the
// requested account's profile, wait for CDP. Returns true when the port is
// live. When `force` is false and the port already answers, nothing is
// closed - we cannot tell WHICH profile owns a live port, so switching is
// only cheap when the caller says the port is already this account's.
async function switchBrowser(label, port, force) {
    const store = load();
    const acc = findAccount(store, label);
    if (!acc) throw new Error(`No account labelled "${label}".`);
    killAutomationChromes();
    await new Promise(r => setTimeout(r, 3000));
    const ok = await launchBrowser(acc, port || 9222);
    if (ok) { store.current = store.accounts.indexOf(acc); store.browser = acc.label; save(store); }
    return ok;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function flag(name, def) {
    const i = process.argv.indexOf(name);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

async function cli() {
    const cmd = process.argv[2] || 'list';
    try {
        if (cmd === 'list' || cmd === 'status') {
            const store = load();
            if (!store.accounts.length) { console.log('(no accounts - add one with: node account_manager.js add --label "acc 1")'); return; }
            const mk = monthKey();
            for (let i = 0; i < store.accounts.length; i++) {
                const a = ensureMonthly(store.accounts[i]);
                if (a.clips_month === mk && store.accounts[i].clips_month !== mk) save(store);
                const active = i === store.current ? ' <-- ACTIVE' : '';
                const state = a.paused ? 'paused' : (a.clips_used >= a.max_clips ? 'EMPTY this month' : 'ok');
                console.log(`${i + 1}. ${a.label}${a.email ? ' <' + a.email + '>' : ''}  ${a.clips_used}/${a.max_clips} clips (${state})${active}`);
            }
        } else if (cmd === 'add') {
            const label = flag('--label');
            if (!label) throw new Error('--label is required');
            const acc = add(label, flag('--email'), flag('--max-clips'));
            console.log(`Added "${acc.label}" (profile: ${acc.profile}, max ${acc.max_clips} clips/month).`);
            console.log(`Sign it in once: node account_manager.js use --label "${acc.label}"`);
        } else if (cmd === 'remove') {
            const gone = remove(flag('--label'));
            console.log(`Removed "${gone.label}".`);
        } else if (cmd === 'set-current') {
            const acc = setCurrent(flag('--label'));
            console.log(`Active account: ${acc.label} (the browser is NOT switched - use 'use' for that)`);
        } else if (cmd === 'use') {
            const label = flag('--label');
            const port = flag('--cdp', '9222');
            console.log(`Switching the automation browser to "${label}" (this closes the old one)...`);
            const ok = await switchBrowser(label, port);
            console.log(ok ? `Browser up on CDP ${port}. Sign this account into Flow once if asked - it is remembered.` : 'Chrome started but the CDP port did not answer within 90s.');
            process.exitCode = ok ? 0 : 1;
        } else if (cmd === 'count') {
            const acc = countClip(flag('--label'), flag('--n', 1));
            if (!acc) throw new Error('unknown account');
            console.log(`${acc.label}: ${acc.clips_used}/${acc.max_clips} clips this month.`);
        } else if (cmd === 'reset') {
            const acc = resetCounter(flag('--label'));
            console.log(`${acc.label}: counter reset to 0/${acc.max_clips}.`);
        } else if (cmd === 'next') {
            const acc = nextAvailable();
            console.log(acc ? acc.label : '(every account is empty or paused this month)');
        } else if (cmd === 'pause' || cmd === 'resume') {
            const acc = setPaused(flag('--label'), cmd === 'pause');
            console.log(`${acc.label}: ${acc.paused ? 'paused' : 'resumed'}.`);
        } else {
            console.log('commands: list | add --label X [--email E] [--max-clips N] | remove --label X | use --label X [--cdp N] | count --label X [--n N] | reset --label X | next | pause --label X | resume --label X');
        }
    } catch (e) {
        console.error(String(e.message || e));
        process.exitCode = 1;
    }
}

if (require.main === module) cli();

module.exports = {
    ACCOUNTS_FILE, PROFILES_ROOT,
    load, save, add, remove, findAccount, currentAccount, setCurrent,
    nextAvailable, countClip, resetCounter, setPaused, setMaxClips,
    profileDir, cdpAlive, switchBrowser, launchBrowser, killAutomationChromes,
    ensureMonthly, monthKey,
};
