// Tests for the multi-key ring and the cast-prompt fixes.
// Run: node test_key_ring.js     (no network, fetch is stubbed)
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

    global.fetch = realFetch;
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})();
