// Tests for analyze_video.js - the reference-video analyser.
//
// The Gemini call itself needs a key and a video, so this covers the two pure
// pieces that shape its output (buildDetail, buildPrompt) and the CLI's refusal
// to run without a URL. No network.
//
// Run: node test_analyze_video.js
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const A = require('./analyze_video.js');
const SRC = fs.readFileSync(path.join(__dirname, 'analyze_video.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 220) : ''}`); }
}

const cm = {
    format: { medium: '2D animated map', clip_seconds: 8, clip_count: 2, narration: true, on_screen_text: true },
    style: 'Clean stylised 2D animated map, glowing borders, cool blues.',
    narration: 'calm curious male voice',
    never_change: 'the same map style and palette',
    segments: [
        { places: ['India', 'Pakistan'], point: 'a line of control, not geography', visual: 'push-in to the line' },
        { places: ['North Korea', 'South Korea'], point: 'the DMZ, most militarised border', visual: 'the strip darkens' },
    ],
};

console.log('\n--- buildDetail turns the analysis into a creator brief ---');
const d = A.buildDetail(cm);
ok('names the genre from the medium', /^Genre: 2D animated map explainer\./.test(d), d.split('\n')[0]);
ok('carries the aesthetic paragraph', d.includes('Clean stylised 2D animated map'));
ok('summarises the format', /Format: 2 clips of 8s, narrated voice-over\./.test(d), d);
ok('notes the reference had on-screen text', !/no on-screen text/.test(d));
ok('beats are numbered and in order',
    /1\. India, Pakistan - a line of control, not geography \(visual: push-in to the line\)/.test(d) &&
    d.indexOf('India') < d.indexOf('North Korea'),
    d);
ok('the beats sit under a Beats: header', /Beats:/.test(d));
ok('an unknown format does not print undefined', !/undefined/.test(A.buildDetail({})));

console.log('\n--- buildPrompt demands an exhaustive map, not a compressed one ---');
const p = A.buildPrompt();
ok('names the clip length it plans to', /about 8 seconds/.test(p), p.slice(0, 200));
ok('asks for an exhaustive facts list', /"facts"/.test(p));
ok('asks for a clip plan', /"clips"/.test(p));
ok('asks for real place names and timings', /"places"/.test(p) && /"t_start"/.test(p) && /"points"/.test(p));
ok('says fast videos name many places', /often name MANY countries/i.test(p));
ok('forbids merging or skipping places', /Do not merge two different countries/i.test(p));
ok('says never to drop a fact to shorten', /NEVER drop a fact/i.test(p));
ok('forbids copying the script', /Never reproduce the narrator/i.test(p));
ok('forbids real people and brands', /No real people, channels, brands/i.test(p));
ok('lists the preset ids so it can suggest one',
    /geography-map - Geography Map/.test(p) && /3d-map - 3D Map/.test(p));
const pinned = A.buildPrompt('3d-zack-style');
const selectedPreset = require('./write_story').loadPreset('3d-zack-style');
ok('selected preset omits the competing preset catalogue',
    !pinned.includes('PRESETS (choose the best id)') && !pinned.includes('geography-map - Geography Map'));
ok('selected preset is locked instead of treated as a suggestion',
    pinned.includes('Set preset_suggestion to "3d-zack-style"') && !pinned.includes('unless it is a poor fit'));
ok('selected preset carries its full current master instructions',
    pinned.includes(JSON.stringify(selectedPreset, null, 2)));
const secondPreset = A.buildPrompt('relationship-dialogue-real');
ok('switching presets replaces the master instructions',
    secondPreset.includes('SELECTED PRESET: relationship-dialogue-real') && !secondPreset.includes('3d-zack-style'));
const dialoguePreset = A.buildPrompt('relationship-dialogue');
ok('relationship analysis transcribes the source conversation',
    /source_dialogue/.test(dialoguePreset) && /DIALOGUE TRANSCRIPTION IS GROUND TRUTH/.test(dialoguePreset));
ok('relationship analysis forbids replacing it with a newly written conversation',
    /Never replace it with a newly written conversation/.test(dialoguePreset));
ok('ordinary presets still request facts rather than source dialogue',
    !/source_dialogue/.test(pinned));

console.log('\n--- the clip plan is read from "clips", with "segments" still accepted ---');
ok('prefers clips',
    A.clipItems({ clips: [{ index: 1 }], segments: [{ index: 1 }, { index: 2 }] }).length === 1);
ok('falls back to segments', A.clipItems({ segments: [{ index: 1 }] }).length === 1);
ok('tolerates neither', A.clipItems({}).length === 0);

console.log('\n--- buildDetail prints the full fact list ---');
const withFacts = A.buildDetail({
    format: { medium: '3D satellite map', clip_seconds: 8 },
    style: '3D satellite globe.',
    facts: [
        { t: '0:02', places: ['North Korea', 'South Korea'], detail: 'the DMZ, sealed since 1953' },
        { t: '0:05', places: ['Armenia', 'Turkey'], detail: 'a closed land border' },
    ],
    clips: [
        { t_start: '0:00', t_end: '0:08', places: ['North Korea', 'South Korea'], points: ['the DMZ, sealed since 1953'], visual: 'zoom to the peninsula' },
    ],
});
ok('lists every fact', /North Korea, South Korea \[0:02\]: the DMZ, sealed since 1953/.test(withFacts), withFacts);
ok('and the second fact too', /Armenia, Turkey \[0:05\]: a closed land border/.test(withFacts));
ok('under an EVERY FACT header', /EVERY FACT/.test(withFacts));

console.log('\n--- the CLI needs a URL ---');
let code = 0, err = '';
try {
    execFileSync(process.execPath, [path.join(__dirname, 'analyze_video.js')], { encoding: 'utf8', stdio: 'pipe' });
} catch (e) { code = e.status; err = String(e.stderr || ''); }
ok('no URL exits 1', code === 1, String(code));
ok('and prints the usage line', /Usage: node analyze_video\.js/.test(err), err.slice(0, 140));

// ── the retry policy ────────────────────────────────────────────────────────
// This is the part that decides whether a "503 high demand" spike costs the
// whole batch. It is driven here against a fake API on a virtual clock, so the
// assertions are about the POLICY, not about how long the test takes.
console.log('\n--- a busy model is outlasted, not given up on ---');

const MODELS = ['m-new', 'm-mid', 'm-old'];

// A key ring that behaves like the real one for the parts askVideo touches.
function fakeRing(n) {
    const keys = Array.from({ length: n || 1 }, (_, i) => 'key' + (i + 1));
    let i = 0;
    const dead = new Set();
    return {
        calls: [],
        get size() { return keys.length; },
        get current() { return keys[i]; },
        get label() { return `key ${i + 1}/${keys.length}`; },
        retire() { dead.add(keys[i]); if (i < keys.length - 1) { i++; return true; } return false; },
        // Mirrors KeyRing.next(): rotate without retiring, false if no other
        // live key exists. Covered properly in test_key_ring.js.
        next() {
            if (keys.length < 2) return false;
            for (let n = 1; n <= keys.length; n++) {
                const j = (i + n) % keys.length;
                if (dead.has(keys[j])) continue;
                if (j === i) return false;
                i = j;
                return true;
            }
            return false;
        },
    };
}
const httpErr = (status, message) => Object.assign(new Error(message || ('HTTP ' + status)), { status });

// A harness: `script` is called per attempt and returns a value or throws.
// Time is virtual - sleep() just advances the clock - so a ten-minute budget
// runs in microseconds and the timings can be asserted exactly.
function harness(script, opts = {}) {
    const ring = fakeRing(opts.keys || 1);
    let t = 0;
    const waits = [], models = [], keys = [];
    let n = 0;
    const call = async (key, model) => {
        models.push(model); keys.push(key);
        const r = script(n++, model, key);
        if (r instanceof Error) throw r;
        return r;
    };
    const args = {
        models: opts.models || MODELS,
        call,
        sleep: async (ms) => { waits.push(ms); t += ms; },
        now: () => t,
        log: () => {},
        budgetMs: opts.budgetMs !== undefined ? opts.budgetMs : 600000,
        ring,
    };
    return {
        ring, waits, models, keys,
        run: () => A.askVideo(ring, 'prompt', args),
        clock: () => t,
    };
}
const goodReply = { candidates: [{ content: { parts: [{ text: '{"title_suggestion":"Ok"}' }] } }] };

(async () => {
    // The old policy: two tries on a model, then the next, then throw - six
    // models walked in ~90s. Assert it now keeps going well past that.
    const h1 = harness(() => httpErr(503, '503 This model is currently experiencing high demand.'));
    let threw = null;
    try { await h1.run(); } catch (e) { threw = e; }
    ok('a permanent 503 still throws in the end', !!threw, String(threw && threw.message));
    ok('it keeps retrying far past the old 2-tries-per-model limit',
        h1.models.length > 6, `${h1.models.length} attempts`);
    ok('it spends the whole budget before giving up',
        h1.clock() >= 600000, `${h1.clock()}ms of 600000ms`);
    ok('it does not overshoot the budget by more than one wait',
        h1.clock() <= 600000 + 46000, `${h1.clock()}ms`);
    ok('it walks more than one model', new Set(h1.models).size > 1, [...new Set(h1.models)].join(','));
    ok('the error says how long it tried and over which models',
        /gave up after 10 min/.test(threw.message) && /m-new/.test(threw.message), threw.message);
    ok('the 503 status survives the re-wrap, so callers can still classify it',
        threw.status === 503, String(threw.status));

    // A spike that clears: the analysis must come back, not fail.
    const h2 = harness((n) => (n < 5 ? httpErr(503, '503 high demand') : goodReply));
    const cm2 = await h2.run();
    ok('a spike that clears mid-retry returns the analysis', cm2 && cm2.title_suggestion === 'Ok');
    ok('and it took six attempts to get there', h2.models.length === 6, String(h2.models.length));
    ok('with backoff that grows', h2.waits[0] < h2.waits[1] && h2.waits[1] < h2.waits[2],
        h2.waits.join(','));

    // Backoff shape: 4,8,16,32 then capped, and always jittered.
    ok('backoff starts at ~4s', A.backoffMs(1, () => 0) === 4000, String(A.backoffMs(1, () => 0)));
    ok('backoff doubles', A.backoffMs(2, () => 0) === 8000 && A.backoffMs(3, () => 0) === 16000);
    ok('backoff is capped, not unbounded', A.backoffMs(20, () => 0) === 45000, String(A.backoffMs(20, () => 0)));
    ok('backoff carries jitter so parallel runs do not collide',
        A.backoffMs(1, () => 0.999) > A.backoffMs(1, () => 0));
    ok('a stale attempt count cannot produce a negative backoff', A.backoffMs(0, () => 0) === 4000);

    // A dropped socket (no status) is transient too.
    const h3 = harness((n) => (n < 2 ? new Error('fetch failed') : goodReply));
    ok('a network drop is retried like a 5xx', (await h3.run()).title_suggestion === 'Ok');

    // A quota 429 rotates the key and keeps the same model.
    const h4 = harness((n) => (n === 0 ? httpErr(429, 'quota exceeded') : goodReply), { keys: 2 });
    const cm4 = await h4.run();
    ok('a 429 rotates to the next key', cm4.title_suggestion === 'Ok' && h4.keys[1] === 'key2',
        h4.keys.join(','));
    ok('and stays on the same model while doing it', h4.models[0] === h4.models[1], h4.models.join(','));

    // A key that is refused (403) rotates rather than retrying.
    const h5 = harness((n) => (n === 0 ? httpErr(403, 'permission denied') : goodReply), { keys: 2 });
    ok('a rejected key rotates too', (await h5.run()).title_suggestion === 'Ok');

    // Every key dead: surface the error instead of spinning.
    const h6 = harness(() => httpErr(429, 'quota exceeded'), { keys: 2 });
    let threw6 = null;
    try { await h6.run(); } catch (e) { threw6 = e; }
    ok('when every key is spent the quota error is what surfaces', threw6 && threw6.status === 429);

    // A model this key cannot use must not burn the budget - step past it.
    const h7 = harness((n, model) => (model === 'm-new' ? httpErr(404, 'model not found') : goodReply));
    ok('a 404 steps to the next model instead of waiting', (await h7.run()).title_suggestion === 'Ok');
    ok('and it did not sleep on the way', h7.waits.length === 0, h7.waits.join(','));
    ok('having tried the unusable model first', h7.models[0] === 'm-new', h7.models.join(','));

    // But a chain where EVERY model 404s must terminate, not loop forever.
    const h8 = harness(() => httpErr(404, 'model not found'));
    let threw8 = null;
    try { await h8.run(); } catch (e) { threw8 = e; }
    ok('a chain of all-404 models throws instead of spinning', !!threw8, String(threw8 && threw8.message));
    ok('after exactly one pass over the chain', h8.models.length === MODELS.length, String(h8.models.length));

    // A malformed reply is sampled again rather than failing the run.
    const h9 = harness((n) => (n === 0
        ? { candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] }
        : goodReply));
    ok('an unparseable reply is retried', (await h9.run()).title_suggestion === 'Ok');

    // A hard error that is neither transient nor a model problem must not be
    // swallowed by retries: a bad key, a bad request.
    const h10 = harness(() => httpErr(400, 'invalid argument: bad field'));
    let threw10 = null;
    try { await h10.run(); } catch (e) { threw10 = e; }
    ok('a genuine 400 fails immediately', !!threw10 && h10.models.length === 1, String(h10.models.length));

    // ── capacity is per-project, so a busy chain moves to another key ────────
    // This is the fix for the run that died with twelve keys configured: a 503
    // never rotated the ring, so one key's chain was all the capacity the job
    // could ever reach.
    const h11 = harness(() => httpErr(503, '503 high demand'), { keys: 4, budgetMs: 120000 });
    let threw11 = null;
    try { await h11.run(); } catch (e) { threw11 = e; }
    ok('a busy chain rotates through every key, not just the first',
        new Set(h11.keys).size === 4, [...new Set(h11.keys)].join(','));
    ok('and it still respects the budget while doing it',
        h11.clock() <= 120000 + 46000, `${h11.clock()}ms`);

    // With one key there is nothing to rotate to, so it must not pretend there
    // is - it should just keep waiting out the spike.
    const h12 = harness(() => httpErr(503, '503 high demand'), { keys: 1, budgetMs: 60000 });
    let threw12 = null;
    try { await h12.run(); } catch (e) { threw12 = e; }
    ok('a single-key ring keeps waiting instead of rotating', !!threw12 && h12.clock() >= 60000,
        `${h12.clock()}ms, ${h12.models.length} attempts`);

    // A busy chain that clears once a different key is tried must succeed -
    // this is the exact shape of the user's failing run.
    const h13 = harness((n, model, key) => (key === 'key1' ? httpErr(503, '503 high demand') : goodReply),
        { keys: 3, budgetMs: 600000 });
    ok('an overloaded first key is rescued by the second',
        (await h13.run()).title_suggestion === 'Ok', h13.keys.join(','));
    ok('and it did not need the whole budget to find out', h13.clock() < 120000, `${h13.clock()}ms`);

    // ── a pinned model is a preference, not a cage ──────────────────────────
    // The batch passes exactly one model. "High demand" is a PER-MODEL error, so
    // pinning narrowed the analysis to one model's capacity no matter how many
    // keys were in the ring - the user's live run had twelve keys and one model.
    console.log('\n--- --model x keeps the other models behind it ---');
    const DEF = 'm-new,m-mid,m-old';
    ok('a pinned model comes first', A.modelChain('m-mid', DEF)[0] === 'm-mid',
        A.modelChain('m-mid', DEF).join(','));
    ok('and the rest stay behind it as fallbacks',
        A.modelChain('m-mid', DEF).join(',') === 'm-mid,m-new,m-old',
        A.modelChain('m-mid', DEF).join(','));
    ok('the pinned model is not repeated',
        new Set(A.modelChain('m-mid', DEF)).size === A.modelChain('m-mid', DEF).length);
    ok('no pin gives the whole default chain in order',
        A.modelChain('', DEF).join(',') === DEF, A.modelChain('', DEF).join(','));
    ok('an explicit chain is taken literally',
        A.modelChain('a,b', DEF).join(',') === 'a,b', A.modelChain('a,b', DEF).join(','));
    ok('a comma chain is not widened even with one entry spelled twice',
        A.modelChain('a,a', DEF).join(',') === 'a,a', A.modelChain('a,a', DEF).join(','));
    ok('whitespace around a pin is trimmed',
        A.modelChain('  m-mid  ', DEF)[0] === 'm-mid', A.modelChain('  m-mid  ', DEF)[0]);
    ok('the real default chain is behind a real pin',
        A.modelChain('gemini-3.5-flash', 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash').length > 1,
        String(A.modelChain('gemini-3.5-flash', 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash').length));

    // The widening must reach the retry loop, or it is only cosmetic: a 503 on
    // the pinned model has to be able to move to the next one.
    const h14 = harness((n, model) => (model === 'm-mid' ? httpErr(503, '503 high demand') : goodReply),
        { keys: 1, models: A.modelChain('m-mid', DEF), budgetMs: 120000 });
    await h14.run();
    ok('a pinned model that 503s is walked past',
        h14.models.length > 1 && h14.models[0] === 'm-mid', h14.models.join(','));

    // ── one budget for the whole analysis ───────────────────────────────────
    // The fallback used to get a fresh budget on top of the first, so a bad
    // spike meant ten minutes of retrying and then ten more - which is what
    // made the run look hung rather than busy.
    console.log('\n--- the fallback shares the budget, it does not double it ---');
    ok('the first attempt is given the budget', /await askVideo\(ring, buildPrompt\(\), \{ budgetMs \}\)/.test(SRC),
        'budget passed to the link attempt');
    ok('the fallback is given what is left, not a fresh one',
        /budgetMs: left,/.test(SRC) && /const left = Math\.max\(120000, budgetMs - \(Date\.now\(\) - startedAt\)\)/.test(SRC));
    ok('the clock starts before the first attempt',
        SRC.indexOf('const startedAt = Date.now();') < SRC.indexOf('cm = await askVideo(ring, buildPrompt(), { budgetMs })'));

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error('FAILED: ' + (e && e.stack || e));
    process.exit(1);
});
