// remote_config.js
//
// Selector and timing overrides that can be corrected without a code release.
//
// Flow's DOM moves every few weeks, and a renamed class or a relabelled
// button is enough to stop a run dead. Most of those changes are
// shape-preserving - the same dialog with a different class - so the values
// the engine matches on live here instead of being scattered through the
// engine as literals.
//
// Three layers, later wins:
//   1. DEFAULTS below, which reproduce the values the engine shipped with
//   2. a remote JSON document, cached to disk and refreshed in the background
//   3. selectors.json next to this file, which always wins
//
// Layer 3 is the point for a single machine: when Flow changes something,
// you edit selectors.json and re-run. Layer 2 exists for pushing that same
// fix to copies you have already handed out.
//
// Loading never blocks a run and never throws. A network problem means the
// cached copy is used, and no cached copy means the defaults are.

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');

const DEFAULTS = {
    selectors: {
        // Buttons, matched on aria-label or visible text.
        addClipLabel: 'Add clip',
        startGenerationLabel: 'Start generation',
        startGenerationIcon: 'arrow_forward',
        // The empty prompt box in extend mode, and the placeholder inside it.
        extendPlaceholder: 'What happens next',
        placeholderSelector: '.prosemirror-placeholder',
        // Timeline structure.
        clipsSelector: '.timeline-contents .clip',
        emptySlotSelector: '.extend-placeholder-text',
        durationReadoutSelector: '.duration-timecode-value',
        timelineScrollerSelector: '.timeline-area',
        // Grid and overlays.
        videoTileSelector: 'flow-video-tile',
        overlayContainerSelector: '.cdk-overlay-container',
    },
    patterns: {
        // Read as case-insensitive regexes, so keep them valid regex source.
        errorText: 'sorry, this video failed|something went wrong|failed to generate',
        creditsOut: 'out of credits|insufficient credits|no credits left|get more credits|buy more credits|run out of credits',
    },
    timings: {
        // Quiet period after Start generation before the timeline is expected
        // to move at all. Raise it on a plan that queues for longer.
        minClipWaitMs: 75000,
        // Silence longer than this during a generation means something is
        // stuck - a dialog ate the click, or the job died without saying so.
        stallMs: 90000,
        // How often the timeline is re-read once the minimum wait is over.
        // This is also the watchdog's reaction time.
        timelinePollMs: 3000,
        // Hard ceiling on one clip's generation before the scene is failed.
        maxGenerationMs: 480000,
        // Poll cadence while waiting.
        progressPollMs: 6000,
        // Full attempts per scene, in addition to the first.
        sceneRetries: 2,
        // Backoff base for a retry; each attempt doubles it, then jitters.
        retryBaseMs: 8000,
        // How long to wait for the Flow app shell to mount after navigating.
        shellReadyMs: 45000,
    },
};

// Empty = disabled. Point this at your own JSON host to push selector fixes
// to copies you have already shipped.
const REMOTE_URL = '';
const CACHE_FILE = path.join(os.homedir(), '.veo3-flow', 'remote-config.json');
const LOCAL_FILE = path.join(__dirname, 'selectors.json');
const REFRESH_TTL_MS = 6 * 60 * 60 * 1000;

function isPlainObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
}

// One level deeper than a spread: these are small fixed-shape documents, so
// a full recursive merge would be more machinery than the problem needs.
function merge(base, over) {
    const out = { ...base };
    if (!isPlainObject(over)) return out;
    for (const key of Object.keys(over)) {
        out[key] = isPlainObject(base[key]) && isPlainObject(over[key])
            ? { ...base[key], ...over[key] }
            : over[key];
    }
    return out;
}

function readJson(file) {
    try {
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function fetchJson(url, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; resolve(v); } };
        try {
            const mod = url.startsWith('https') ? https : http;
            const req = mod.get(url, { timeout: timeoutMs }, (res) => {
                if (res.statusCode !== 200) { res.resume(); return done(null); }
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (c) => { if (body.length < 200000) body += c; });
                res.on('end', () => { try { done(JSON.parse(body)); } catch { done(null); } });
            });
            req.on('timeout', () => { req.destroy(); done(null); });
            req.on('error', () => done(null));
        } catch {
            done(null);
        }
    });
}

// Refresh the on-disk cache for the *next* run. Never awaited by startup:
// a slow or dead endpoint must not delay a generation.
function refreshInBackground() {
    if (!REMOTE_URL) return;
    let age = Infinity;
    try {
        if (fs.existsSync(CACHE_FILE)) age = Date.now() - fs.statSync(CACHE_FILE).mtimeMs;
    } catch {}
    if (age < REFRESH_TTL_MS) return;
    fetchJson(`${REMOTE_URL}${REMOTE_URL.includes('?') ? '&' : '?'}t=${Date.now()}`).then((doc) => {
        if (!isPlainObject(doc)) return;
        try {
            fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
            fs.writeFileSync(CACHE_FILE, JSON.stringify(doc, null, 2));
        } catch {}
    }).catch(() => {});
}

// Synchronous on purpose: the engine reads selectors while it is setting up,
// and a config load that can reject would put a network dependency in the
// path of every run.
function load() {
    const sources = ['defaults'];
    let cfg = merge({}, DEFAULTS);

    if (REMOTE_URL) {
        const cached = readJson(CACHE_FILE);
        if (isPlainObject(cached)) { cfg = merge(cfg, cached); sources.push('remote-cache'); }
        refreshInBackground();
    }

    const local = readJson(LOCAL_FILE);
    if (isPlainObject(local)) { cfg = merge(cfg, local); sources.push('selectors.json'); }

    cfg.sources = sources;
    return cfg;
}

// Throws on an invalid pattern rather than letting a bad edit in
// selectors.json surface later as a silently-never-matching regex.
function compilePatterns(cfg) {
    const out = {};
    for (const [k, v] of Object.entries(cfg.patterns || {})) {
        if (k.startsWith('_')) continue;   // "_note" style keys are documentation
        try {
            out[k] = new RegExp(v, 'i');
        } catch (e) {
            throw new Error(`remote_config: patterns.${k} is not a valid regex: ${e.message}`);
        }
    }
    return out;
}

module.exports = { load, compilePatterns, DEFAULTS, LOCAL_FILE, REMOTE_URL };
