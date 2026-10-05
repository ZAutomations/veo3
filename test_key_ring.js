// Tests for the multi-key ring and the cast-prompt fixes.
// Run: node test_key_ring.js     (no network, fetch is stubbed)
//
// No retries and therefore no sleeping: the interesting behaviour here is WHERE
// a failure is sent next (another key, another model, or the caller), and the
// 5s/10s/15s backoff between same-key retries is dead time in a test. The flag
// is read when the module is loaded, so it has to be set first.
process.argv.push('--retries', '0');
const path = require('path');
const fs = require('fs');
const W = require('./write_story.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
}
function eq(name, got, want) {
    ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

console.log('\n--- maskKey never leaks the key ---');
const K = 'AIzaSyD-REAL-SECRET-VALUE-9f2c';
ok('does not contain the secret', !W.maskKey(K).includes('SECRET'), W.maskKey(K));
ok('shows a prefix', W.maskKey(K).startsWith('AIzaSy'));
ok('shows a suffix', W.maskKey(K).endsWith('9f2c'));
ok('short key is not echoed', !W.maskKey('abc123').includes('abc123'));

console.log('\n--- isQuotaError: quota yes, everything else no ---');
const e = (status, message) => Object.assign(new Error(message), { status });
ok('429', W.isQuotaError(e(429, 'Too Many Requests')));
ok('RESOURCE_EXHAUSTED', W.isQuotaError(e(400, 'RESOURCE_EXHAUSTED: quota')));
ok('quota wording', W.isQuotaError(e(429, 'You exceeded your current quota')));
ok('rate limit wording', W.isQuotaError(e(429, 'rate limit reached')));
ok('billing', W.isQuotaError(e(403, 'billing not enabled')));
ok('404 is NOT quota', !W.isQuotaError(e(404, 'model not found')));
ok('400 bad request is NOT quota', !W.isQuotaError(e(400, 'invalid argument')));
ok('plain error is NOT quota', !W.isQuotaError(new Error('socket hang up')));
ok('null is safe', !W.isQuotaError(null));
// The trap: a 403 saying "not quota" must not retire a working key.
ok('403 permission is NOT quota', !W.isQuotaError(e(403, 'caller does not have permission')));

console.log('\n--- isTransient: server trouble yes, client errors no ---');
ok('503', W.isTransient(e(503, 'high demand')));
ok('500', W.isTransient(e(500, 'internal error')));
ok('502', W.isTransient(e(502, 'bad gateway')));
ok('504', W.isTransient(e(504, 'deadline exceeded')));
ok('fetch failed', W.isTransient(new Error('fetch failed')));
ok('socket hang up', W.isTransient(new Error('socket hang up')));
ok('aborted', W.isTransient(new Error('The operation was aborted')));
ok('429 is NOT transient (it rotates keys instead)', !W.isTransient(e(429, 'quota')));
ok('404 is NOT transient', !W.isTransient(e(404, 'not found')));
ok('400 is NOT transient', !W.isTransient(e(400, 'invalid argument')));
ok('null is safe', !W.isTransient(null));
// The two classifications must not overlap, or a quota error would be slept on
// instead of rotated, and a real outage would burn the whole key ring.
ok('nothing is both quota and transient',
   ![e(429, 'quota'), e(503, 'demand'), e(500, 'err')]
       .some(x => W.isQuotaError(x) && W.isTransient(x)));

console.log('\n--- KeyRing rotation ---');
const r = new W.KeyRing(['AIzaFIRSTKEY00000001', 'k2', 'k3']);
eq('starts at 0', r.i, 0);
ok('size', r.size === 3);
ok('label names position and mask',
   r.label.includes('1/3') && r.label.includes(W.maskKey('AIzaFIRSTKEY00000001')),
   r.label);
ok('label does not contain the whole key', !r.label.includes('AIzaFIRSTKEY00000001'), r.label);
ok('retire moves on', r.retire() === true);
eq('now at 1', r.i, 1);
ok('label follows', r.label.includes('2/3'));
r.retire();
eq('now at 2', r.i, 2);
ok('last retire returns false', r.retire() === false);
eq('stays put when exhausted', r.i, 2);
// wrap-around: k2 retired, current k3 -> next live is k1
const r2 = new W.KeyRing(['a1', 'b2', 'c3']);
r2.i = 1; r2.retire();          // b2 dead, moves to c3
eq('from 1 to 2', r2.i, 2);
r2.i = 0; r2.dead = new Set([1, 2]);  // only a1 live
r2.retire();
eq('wraps past the dead to the live one', r2.i, 0);
ok('single key ring cannot retire', new W.KeyRing(['only']).retire() === false);
ok('empty ring label is safe', new W.KeyRing([]).label === 'no key');
ok('single key label has no fraction', !new W.KeyRing(['abcdefghijklmnop']).label.includes('/'));

// next() rotates WITHOUT retiring - the 503 case. A busy model says nothing
// bad about the key, so the key must survive to be used again later.
console.log('\n--- KeyRing.next(): rotate on "high demand" without burning the key ---');
const n1 = new W.KeyRing(['k1', 'k2', 'k3']);
ok('next moves to the second key', n1.next() === true && n1.i === 1, String(n1.i));
ok('the first key is NOT retired', n1.dead.size === 0, String(n1.dead.size));
ok('next keeps moving forward', n1.next() === true && n1.i === 2, String(n1.i));
ok('and wraps around to the first', n1.next() === true && n1.i === 0, String(n1.i));
ok('after a full lap nothing was retired', n1.dead.size === 0);
ok('a single-key ring has nothing to rotate to', new W.KeyRing(['only']).next() === false);
ok('and an empty ring is safe', new W.KeyRing([]).next() === false);
// With one live key left, rotating would just return to where it already is.
const n2 = new W.KeyRing(['k1', 'k2', 'k3']);
n2.dead = new Set([1, 2]);
ok('does not rotate when only one key is live', n2.next() === false, String(n2.i));
ok('and stays on that live key', n2.i === 0);
// Retirement still works alongside it: next() never lands on a retired key.
const n3 = new W.KeyRing(['k1', 'k2', 'k3', 'k4']);
n3.dead = new Set([2]);          // k3 retired
n3.i = 1;
ok('skips a retired key', n3.next() === true && n3.i === 3, String(n3.i));
ok('a retired key is never revived', n3.dead.has(2));
// The two work together: retire the current, then next() from the new one.
const n4 = new W.KeyRing(['k1', 'k2', 'k3']);
n4.retire();                     // k1 gone for the run, now on k2
ok('retire then next lands on k3', n4.next() === true && n4.i === 2, String(n4.i));
ok('and k1 stayed retired', n4.dead.has(0));

console.log('\n--- ask(): falls through on quota, not on other errors ---');
const realFetch = global.fetch;
function stubFetch(behaviour) {
    // behaviour(key) -> {status, body}
    global.fetch = async (url, opts) => {
        const key = opts.headers['x-goog-api-key'];
        const b = behaviour(key);
        return {
            ok: b.status >= 200 && b.status < 300,
            status: b.status,
            text: async () => JSON.stringify(b.body),
        };
    };
}
const goodBody = { candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] };

(async () => {
    // 1. first key out of quota, second works
    let seen = [];
    stubFetch((k) => { seen.push(k); return k === 'good'
        ? { status: 200, body: goodBody }
        : { status: 429, body: { error: { message: 'quota exceeded' } } }; });
    const ring = new W.KeyRing(['dead', 'good']);
    let out = await W.ask(ring, 'm', 'p', 100);
    eq('rotated to the good key', seen, ['dead', 'good']);
    eq('returned parsed json', out, { ok: 1 });
    eq('ring now sits on the good key', ring.i, 1);

    // 2. every key dead -> throws the quota error, having tried all
    seen = [];
    stubFetch((k) => { seen.push(k); return { status: 429, body: { error: { message: 'quota exceeded' } } }; });
    const ring2 = new W.KeyRing(['a', 'b', 'c']);
    let threw = null;
    try { await W.ask(ring2, 'm', 'p', 100); } catch (err) { threw = err; }
    ok('threw once the ring was empty', !!threw);
    ok('it is recognisable as quota', W.isQuotaError(threw));
    eq('tried every key exactly once', seen.sort(), ['a', 'b', 'c']);

    // 3. a 404 must NOT burn the other keys
    seen = [];
    stubFetch((k) => { seen.push(k); return { status: 404, body: { error: { message: 'model not found' } } }; });
    const ring3 = new W.KeyRing(['a', 'b', 'c']);
    try { await W.ask(ring3, 'm', 'p', 100); } catch (err) { /* expected */ }
    eq('stopped at the first key on a 404', seen, ['a']);

    // 4. the dead key is not retried on the next call
    seen = [];
    stubFetch((k) => { seen.push(k); return k === 'good'
        ? { status: 200, body: goodBody }
        : { status: 429, body: { error: { message: 'quota exceeded' } } }; });
    const ring4 = new W.KeyRing(['dead', 'good']);
    await W.ask(ring4, 'm', 'p', 100);
    seen = [];
    await W.ask(ring4, 'm', 'p', 100);
    eq('second call goes straight to the good key', seen, ['good']);

    // 5. a dead model in a CHAIN falls back to the next model
    const modelsTried = [];
    global.fetch = async (url) => {
        const model = String(url).split('/models/')[1].split(':')[0];
        modelsTried.push(model);
        if (model === 'bad') {
            return { ok: false, status: 404, text: async () => JSON.stringify({ error: { message: 'model not found' } }) };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify(goodBody) };
    };
    const out5 = await W.ask(new W.KeyRing(['k']), ['bad', 'good'], 'p', 100);
    eq('fell back to the next model', out5, { ok: 1 });
    eq('tried the models newest-first', modelsTried, ['bad', 'good']);

    // 6. a lone dead model still throws, rather than passing silently
    let threw5 = null;
    try { await W.ask(new W.KeyRing(['k']), ['bad'], 'p', 100); } catch (err) { threw5 = err; }
    ok('a chain of one that 404s throws', !!threw5);
    ok('and is recognisable as a model error', W.isModelError(threw5));
    ok('a quota error is not a model error', !W.isModelError(Object.assign(new Error('quota'), { status: 429 })));

    // ── a 503 is capacity, and capacity is per key ──────────────────────────
    // The failure this was written for, from a real run: three keys loaded, one
    // busy key, and the log showing model after model failing while the KEY
    // never changed once -
    //
    //   503 from the API - retrying in 5s (1/2)
    //   503 from the API - retrying in 10s (2/2)
    //   gemini-3.5-flash is still failing - falling back to gemini-3.8-flash
    //   ... then the same two tries and the same key on every model in the
    //   chain, until the whole story write died four minutes in.
    //
    // KeyRing.next() was written for exactly this - "capacity is allocated per
    // Google Cloud PROJECT and every key here is a different project" - and was
    // never called from anywhere.
    console.log('\n--- a 503 is handed to the next key, not slept on ---');
    {
        const seen503 = [];
        stubFetch((k) => {
            seen503.push(k);
            return k === 'good'
                ? { status: 200, body: goodBody }
                : { status: 503, body: { error: { message: 'high demand' } } };
        });
        const ring503 = new W.KeyRing(['busy', 'good']);
        const out503 = await W.ask(ring503, 'm', 'p', 100);
        eq('the queued key was left and the next one asked', seen503, ['busy', 'good']);
        eq('and its answer is the one that is used', out503, { ok: 1 });
        eq('the ring now sits on it', ring503.i, 1);
        ok('the busy key was NOT retired - it is live for the next call', ring503.dead.size === 0);
    }
    {
        // Every key queued, one model: give up, but having asked EVERY key once
        // rather than asking the first one twice and never asking the others.
        const seenAll = [];
        stubFetch((k) => { seenAll.push(k); return { status: 503, body: { error: { message: 'high demand' } } }; });
        const ringAll = new W.KeyRing(['a', 'b', 'c']);
        let threwAll = null;
        try { await W.ask(ringAll, 'm', 'p', 100); } catch (err) { threwAll = err; }
        ok('a ring that is queued everywhere gives up', !!threwAll);
        eq('but only after asking all three keys', seenAll.sort(), ['a', 'b', 'c']);
        ok('and none of them was retired', ringAll.dead.size === 0);
        ok('the error is still recognisable as transient', W.isTransient(threwAll));
    }
    {
        // The chain is the second line of defence: model 2, on a free key.
        const tried = [];
        global.fetch = async (url, opts) => {
            const model = String(url).split('/models/')[1].split(':')[0];
            const key = opts.headers['x-goog-api-key'];
            tried.push(`${model}:${key}`);
            if (model === 'm2' && key === 'b') {
                return { ok: true, status: 200, text: async () => JSON.stringify(goodBody) };
            }
            return { ok: false, status: 503, text: async () => JSON.stringify({ error: { message: 'high demand' } }) };
        };
        const outChain = await W.ask(new W.KeyRing(['a', 'b']), ['m1', 'm2'], 'p', 100);
        eq('the second model on the second key answered', outChain, { ok: 1 });
        ok('both keys were asked before the model was changed',
           tried.includes('m1:a') && tried.includes('m1:b'), tried.join(' '));
        ok('and the new model was given the ring again, not just the last key',
           tried.includes('m2:a') || tried.includes('m2:b'), tried.join(' '));
    }
    {
        // A reply that is not JSON is about the MODEL, not the key. Rotating on
        // one would spend every key on the same bad generation.
        const seenParse = [];
        stubFetch((k) => {
            seenParse.push(k);
            return { status: 200, body: { candidates: [{ content: { parts: [{ text: 'sorry, no json here' }] } }] } };
        });
        try { await W.ask(new W.KeyRing(['a', 'b']), 'm', 'p', 100); } catch (err) { /* expected */ }
        eq('a parse error stays on the key that produced it', seenParse, ['a']);
    }
    {
        // The operator has to be able to SEE the key change, or the log reads
        // exactly like the run that failed.
        const lines = [];
        const realLog = console.log;
        console.log = (...a) => lines.push(a.join(' '));
        stubFetch((k) => (k === 'good'
            ? { status: 200, body: goodBody }
            : { status: 503, body: { error: { message: 'high demand' } } }));
        await W.ask(new W.KeyRing(['busykey00000001', 'good']), 'm', 'p', 100);
        console.log = realLog;
        const said = lines.join('\n');
        ok('the log says the model is busy on that key', /m is busy on/.test(said), said.trim());
        ok('and names the key it tries next', /trying key 2\/2/.test(said), said.trim());
        ok('without ever printing a whole key',
           !said.includes('busykey00000001') && !said.includes('good'), said.trim());
    }
    {
        // A large ring must not spend every project on one busy model. The
        // fourth request should already be the next model.
        const tried = [];
        global.fetch = async (url, opts) => {
            const model = String(url).split('/models/')[1].split(':')[0];
            tried.push(`${model}:${opts.headers['x-goog-api-key']}`);
            return model === 'good'
                ? { ok: true, status: 200, text: async () => JSON.stringify(goodBody) }
                : { ok: false, status: 503, text: async () => JSON.stringify({ error: { message: 'high demand' } }) };
        };
        const many = Array.from({ length: 11 }, (_, i) => `k${i + 1}`);
        const result = await W.ask(new W.KeyRing(many), ['busy', 'good'], 'p', 100);
        eq('fallback model answers after the busy one', result, { ok: 1 });
        ok('only three independent keys are spent on the busy model',
           tried.filter(x => x.startsWith('busy:')).length === 3, tried.join(' '));
        ok('the next model is reached on request four', tried[3].startsWith('good:'), tried.join(' '));
    }

    global.fetch = realFetch;

    // ── a pinned model is a preference, not a cage ──────────────────────────
    // The other half of reaching the ring's capacity. Rotating keys is useless
    // if the chain behind them is one model: "high demand" is a PER-MODEL error,
    // so a single pinned model caps the run at one model's capacity however many
    // keys are live. The MCP batch passes exactly one model.
    console.log('\n--- modelChain: --model x keeps the rest behind it ---');
    const DEF = 'm-new,m-mid,m-old';
    const eqc = (name, got, want) => ok(name, got.join(',') === want, got.join(','));
    eqc('a pinned model comes first', W.modelChain('m-mid', DEF), 'm-mid,m-new,m-old');
    eqc('no pin gives the whole default chain', W.modelChain('', DEF), DEF);
    eqc('no pin at all gives the whole default chain', W.modelChain(undefined, DEF), DEF);
    eqc('an explicit chain is taken literally', W.modelChain('a,b', DEF), 'a,b');
    eqc('an explicit chain of one is still widened', W.modelChain('a', DEF), 'a,m-new,m-mid,m-old');
    ok('the pinned model is not repeated when it is also a default',
        W.modelChain('m-mid', DEF).filter((m) => m === 'm-mid').length === 1,
        W.modelChain('m-mid', DEF).join(','));
    eqc('whitespace around a pin is trimmed', W.modelChain('  m-mid , m-old ', DEF), 'm-mid,m-old');
    ok('an empty default does not leave a hole',
        W.modelChain('a', '').join(',') === 'a', W.modelChain('a', '').join(','));
    ok('the real chain really is behind a real pin',
        W.modelChain('gemini-3.5-flash', W.DEFAULT_MODELS).length ===
        new Set(W.DEFAULT_MODELS.split(',')).size,
        String(W.modelChain('gemini-3.5-flash', W.DEFAULT_MODELS).length));
    ok('and the pin still leads it',
        W.modelChain('gemini-3.5-flash', W.DEFAULT_MODELS)[0] === 'gemini-3.5-flash');

    // The widening has to reach the retry loop, not just the constant: a 503 on
    // the pinned model must be able to move on to the next one.
    modelsTried.length = 0;
    global.fetch = async (url) => {
        const m = String(url).split('/models/')[1].split(':')[0];
        modelsTried.push(m);
        return m === 'm-mid'
            ? { ok: false, status: 503, text: async () => JSON.stringify({ error: { message: 'high demand' } }) }
            : { ok: true, status: 200, text: async () => JSON.stringify(goodBody) };
    };
    let pinned = null;
    try {
        pinned = await W.ask(new W.KeyRing(['k1', 'k2']), W.modelChain('m-mid', DEF), 'p', 5000);
    } catch (e) { pinned = e; }
    ok('a pinned model that 503s is walked past', pinned && pinned.ok === 1, JSON.stringify(pinned));
    ok('and the pinned model was tried first', modelsTried[0] === 'm-mid', modelsTried.join(','));
    ok('with another model reached after it', modelsTried.includes('m-new'), modelsTried.join(','));

    // The caller needs to know WHICH model answered to retry without it - but
    // the answer itself is the caller's data and must come back untouched. An
    // earlier attempt attached a `_model` key to it, which followed the object
    // into the story and broke the deep-equality checks here.
    modelsTried.length = 0;
    global.fetch = async (url) => {
        const m = String(url).split('/models/')[1].split(':')[0];
        modelsTried.push(m);
        return { ok: true, status: 200, text: async () => JSON.stringify(goodBody) };
    };
    const said = {};
    const withMeta = await W.ask(new W.KeyRing(['k']), ['m-mid', 'm-new'], 'p', 5000, said);
    eq('the answering model is reported out of band', said.model, 'm-mid');
    eq('and the reply itself is untouched', withMeta, { ok: 1 });
    eq('no bookkeeping key leaked into the data', Object.keys(withMeta).join(','), 'ok');
    const noMeta = await W.ask(new W.KeyRing(['k']), ['m-mid'], 'p', 5000);
    eq('ask still works without the meta object', noMeta, { ok: 1 });
    global.fetch = realFetch;

    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})();
