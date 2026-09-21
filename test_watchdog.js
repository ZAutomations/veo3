// test_watchdog.js - drives the real generation wait loop against a stub page.
//
//   node test_watchdog.js
//
// The watchdog is the part of this work that cannot be checked by reading it:
// whether it stays quiet on a healthy generation, fires on a stuck one, and
// lets a page-reported error end the wait. Timings are wound right down here
// so a decision that takes minutes in the field runs in milliseconds.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Squeeze the clock before the engine reads its config.
const localPath = path.join(__dirname, 'selectors.json');
const saved = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : null;
fs.writeFileSync(localPath, JSON.stringify({
    timings: {
        minClipWaitMs: 60,
        stallMs: 120,
        progressPollMs: 20,
        timelinePollMs: 40,
        maxGenerationMs: 2500,
        sceneRetries: 2,
        retryBaseMs: 20,
    },
}));

const { Veo3FlowNewUI, CONFIG } = require('./veo3_flow_new_ui.js');

const wait = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;

async function check(name, fn) {
    try { await fn(); console.log(`  ok    ${name}`); }
    catch (e) { failures++; console.log(`  FAIL  ${name}\n          ${e.message}`); }
}

// A page stub that answers the probes the wait loop makes. `script` decides
// what each poll sees; `sweeps` records every heal so we can assert on it.
function stubEngine(script) {
    const engine = new Veo3FlowNewUI(path.join(__dirname, 'stories', 'x.json'),
                                    { fromScene: 1, toScene: 1, projectUrl: 'x' });
    engine.state = { timeline: script.startSeconds || 0, pct: null };
    engine.sweeps = [];
    engine.polls = 0;

    engine.evalJs = async (fn, ...args) => {
        const src = fn.toString();
        if (/progressbar/.test(src)) {                 // READ_PROGRESS
            return { pct: engine.state.pct, src: engine.state.pct === null ? 'none' : 'text' };
        }
        if (/always approve/.test(src)) {              // READ_STATE
            return {
                url: 'https://flow.google.com/project/a/scene/b',
                generating: script.generating !== false,
                failed: !!engine.state.failed,
                errorText: engine.state.errorText || null,
                approve: false,
                creditsOut: !!engine.state.creditsOut,
            };
        }
        // getTimelineSeconds. Matched on the parameter it now takes rather
        // than a literal class name, which moved into remote_config.
        if (/readoutSel/.test(src)) {
            return engine.state.timeline;
        }
        return null;
    };

    // Record heals instead of driving a sweep against a page stub.
    engine.healStalled = async (reason, force) => {
        engine.sweeps.push(reason);
        engine._heals++;
        engine._lastMoveAt = Date.now();
        if (script.sweepReturnsError) return { dismissed: ['x'], errorText: 'sorry, this video failed', overlays: 1 };
        return { dismissed: script.sweepDismisses ? ['Got it'] : [], errorText: null, overlays: 1 };
    };
    return engine;
}

async function main() {
    console.log('\nwatchdog');

    await check('a healthy generation that finishes is not flagged as stalled', async () => {
        const e = stubEngine({ startSeconds: 8 });
        // Timeline reaches the target shortly after the minimum wait.
        setTimeout(() => { e.state.timeline = 15; }, 80);
        const secs = await e.waitForExtendComplete(2, 8, 0);
        assert.strictEqual(secs, 15, `expected timeline 15, got ${secs}`);
        assert.strictEqual(e.sweeps.length, 0, `healed ${e.sweeps.length} times on a healthy run`);
    });

    await check('a real percentage counts as movement and holds the watchdog off', async () => {
        const e = stubEngine({ startSeconds: 8 });
        let pct = 0;
        const tick = setInterval(() => { pct += 4; e.state.pct = Math.min(pct, 99); }, 30);
        setTimeout(() => { clearInterval(tick); e.state.timeline = 15; }, 260);
        const secs = await e.waitForExtendComplete(2, 8, 0);
        assert.strictEqual(secs, 15);
        assert.strictEqual(e.sweeps.length, 0, 'a rising percentage must not look like a stall');
    });

    await check('a stuck generation is healed', async () => {
        const e = stubEngine({ startSeconds: 8, sweepDismisses: true });
        // Nothing ever moves: no percentage, timeline frozen.
        const p = e.waitForExtendComplete(2, 8, 0).catch(err => err);
        await wait(CONFIG.minClipWaitMs + CONFIG.stallMs + 200);
        assert.ok(e.sweeps.length >= 1, 'expected the watchdog to heal a frozen generation');
        e.state.timeline = 15;   // let it finish so the promise resolves
        await p;
    });

    await check('healing is capped so a dead page cannot loop forever', async () => {
        const e = stubEngine({ startSeconds: 8, sweepDismisses: true });
        CONFIG.maxGenerationMs = 400;   // short ceiling so the loop ends quickly
        const err = await e.waitForExtendComplete(2, 8, 0).catch(x => x);
        assert.ok(err instanceof Error, 'expected a timeout, got a resolved wait');
        assert.ok(/TIMEOUT/.test(err.message), `unexpected error: ${err.message}`);
        assert.ok(e.sweeps.length <= 3, `healed ${e.sweeps.length} times, expected at most 3`);
        assert.ok(e.sweeps.length >= 1, 'expected at least one heal before giving up');
        CONFIG.maxGenerationMs = 2500;
    });

    await check('an error the page reports while healing ends the wait', async () => {
        const e = stubEngine({ startSeconds: 8, sweepReturnsError: true });
        const err = await e.waitForExtendComplete(2, 8, 0).catch(x => x);
        assert.ok(err instanceof Error, 'expected a failure, got a resolved wait');
        assert.ok(/FAILED/.test(err.message), `unexpected error: ${err.message}`);
    });

    await check('a drained account stops the run', async () => {
        const e = stubEngine({ startSeconds: 8 });
        e.state.creditsOut = true;
        const err = await e.waitForExtendComplete(2, 8, 0).catch(x => x);
        assert.ok(/CREDITS_EXHAUSTED/.test(err.message), `unexpected error: ${err.message}`);
    });

    await check('an early page error ends the minimum wait immediately', async () => {
        const e = stubEngine({ startSeconds: 8 });
        e.state.failed = true;
        e.state.errorText = 'Something went wrong';
        const started = Date.now();
        const err = await e.waitForExtendComplete(2, 8, 0).catch(x => x);
        assert.ok(/FAILED/.test(err.message), `unexpected error: ${err.message}`);
        assert.ok(Date.now() - started < CONFIG.minClipWaitMs, 'should not sit out the minimum wait');
    });

    console.log('\nretry');

    await check('a scene that fails then succeeds is not recorded as failed', async () => {
        const e = stubEngine({});
        const recorded = [];
        e.logFailedPrompt = async (...a) => recorded.push(a);
        e.healStalled = async () => {};
        let calls = 0;
        e.processScene = async () => { calls++; if (calls < 2) throw new Error('transient'); };
        const ok = await e.processSceneWithRetry({ veo3_prompt: 'p' }, 0);
        assert.strictEqual(ok, true, 'expected the retry to report success');
        assert.strictEqual(calls, 2, `expected 2 attempts, saw ${calls}`);
        assert.strictEqual(recorded.length, 0, 'a recovered scene must not leave a failure note');
    });

    await check('a scene that never succeeds is recorded once and the run continues', async () => {
        const e = stubEngine({});
        const recorded = [];
        e.logFailedPrompt = async (...a) => recorded.push(a);
        e.healStalled = async () => {};
        let calls = 0;
        e.processScene = async () => { calls++; throw new Error('permanent'); };
        const ok = await e.processSceneWithRetry({ veo3_prompt: 'p' }, 4);
        assert.strictEqual(ok, false, 'expected the wrapper to report giving up');
        assert.strictEqual(calls, CONFIG.sceneRetries + 1, `expected ${CONFIG.sceneRetries + 1} attempts, saw ${calls}`);
        assert.strictEqual(recorded.length, 1, `expected one failure note, saw ${recorded.length}`);
        assert.strictEqual(recorded[0][0], 5, 'the note should name the 1-based scene number');
    });

    await check('a drained account is not retried', async () => {
        const e = stubEngine({});
        e.logFailedPrompt = async () => {};
        e.healStalled = async () => {};
        let calls = 0;
        e.processScene = async () => { calls++; throw new Error('CREDITS_EXHAUSTED'); };
        const err = await e.processSceneWithRetry({ veo3_prompt: 'p' }, 0).catch(x => x);
        assert.ok(/CREDITS_EXHAUSTED/.test(err.message), 'the drain must reach run()');
        assert.strictEqual(calls, 1, 'retrying a drained account just burns time');
    });

    if (saved === null) fs.unlinkSync(localPath);
    else fs.writeFileSync(localPath, saved);

    console.log(failures ? `\n${failures} FAILED\n` : '\nall good\n');
    process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
