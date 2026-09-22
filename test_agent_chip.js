// Tests for the Agent Mode chip reader in generate_refs.js.
//
// The chip is the whole switch: with Agent Mode ON, Flow does not offer the
// image models at all, so a reference-sheet prompt submitted in that state comes
// back as a clip. The reader below must be right about a DOM we do not control,
// so it is pinned here against the two real outerHTML snapshots taken from a
// live Flow project - OFF and ON.
//
// The chip is Angular: the host gets class "checked" while ON, and the inner
// button gets "agent-mode-chip-checked" plus aria-pressed="true".
//
// Run: node test_agent_chip.js     (no browser, no network)
const G = require('./generate_refs.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + extra : ''}`); }
}

// A stand-in for the element objects page.evaluate sees inside the page.
function el(className, attrs = {}) {
    const node = {
        className,
        _child: null,
        getAttribute: (k) => (k in attrs ? attrs[k] : null),
        querySelector: () => node._child,
    };
    return node;
}
// A fake page whose document holds one chip. click() flips the state and
// re-renders the classes, which is what the Angular binding does after the click.
function fakePage(initial, { missing = false } = {}) {
    const state = { on: initial, clicks: 0 };
    const btn = el(initial ? 'agent-mode-chip agent-mode-chip-checked' : 'agent-mode-chip',
                   { 'aria-pressed': String(initial) });
    const host = el(initial ? 'checked' : '');
    host._child = btn;
    btn.click = () => {
        state.clicks++;
        state.on = !state.on;
        host.className = state.on ? 'checked' : '';
        btn.className = state.on ? 'agent-mode-chip agent-mode-chip-checked' : 'agent-mode-chip';
        btn.getAttribute = (k) => (k === 'aria-pressed' ? String(state.on) : null);
    };
    global.document = {
        querySelector: (sel) => (missing ? null : (sel === 'flow-agent-mode-toggle-chip' ? host : null)),
    };
    return { page: { evaluate: (fn) => fn() }, state };
}
// A page whose host and button disagree, to prove which binding is trusted.
function pageWith(hostClass, btnClass, pressed) {
    const btn = el(btnClass, { 'aria-pressed': pressed });
    const host = el(hostClass);
    host._child = btn;
    global.document = { querySelector: () => host };
    return { evaluate: (fn) => fn() };
}

(async () => {
    console.log('\n--- the two DOM snapshots from the live page ---');

    // OFF: <flow-agent-mode-toggle-chip ...><button class="agent-mode-chip" aria-pressed="false">
    let t = fakePage(false);
    ok('reads OFF when the host has no class and aria-pressed="false"',
       (await G.agentOn(t.page)) === false, await G.agentOn(t.page));

    // ON: <flow-agent-mode-toggle-chip class="checked"><button class="agent-mode-chip agent-mode-chip-checked" aria-pressed="true">
    t = fakePage(true);
    ok('reads ON when the host carries class "checked"',
       (await G.agentOn(t.page)) === true, await G.agentOn(t.page));

    console.log('\n--- either binding on its own still reads correctly ---');
    ok('button class alone reads ON',
       (await G.agentOn(pageWith('', 'agent-mode-chip agent-mode-chip-checked', 'true'))) === true);
    ok('aria-pressed alone reads ON',
       (await G.agentOn(pageWith('', 'agent-mode-chip', 'true'))) === true);
    ok('a bare "agent-mode-chip" button with no true attribute reads OFF',
       (await G.agentOn(pageWith('', 'agent-mode-chip', 'false'))) === false);

    console.log('\n--- not a project page ---');
    t = fakePage(false, { missing: true });
    ok('no chip at all reads null, not a guessed answer',
       (await G.agentOn(t.page)) === null, await G.agentOn(t.page));

    console.log('\n--- turning it off, which is the job ---');
    t = fakePage(true);
    let r = await G.setAgent(t.page, false);
    ok('turns an ON chip OFF', r.ok && r.changed, JSON.stringify(r));
    ok('and it reads OFF afterwards', (await G.agentOn(t.page)) === false);
    ok('exactly one click was needed', t.state.clicks === 1, t.state.clicks);

    t = fakePage(false);
    r = await G.setAgent(t.page, false);
    ok('an already-off chip is left alone', r.ok && !r.changed, JSON.stringify(r));
    ok('and was not clicked', t.state.clicks === 0, t.state.clicks);

    console.log('\n--- handing it back for the film run ---');
    t = fakePage(false);
    r = await G.setAgent(t.page, true);
    ok('turns an OFF chip back ON', r.ok && r.changed, JSON.stringify(r));
    ok('and it reads ON afterwards', (await G.agentOn(t.page)) === true);

    console.log('\n--- a dead toggle is reported, never assumed to have worked ---');
    {
        // The click lands but Angular never re-renders: the state does not change.
        const btn = el('agent-mode-chip', { 'aria-pressed': 'false' });
        btn.click = () => {};
        const host = el('checked');          // host says ON, button says OFF
        host._child = btn;
        global.document = { querySelector: () => host };
        r = await G.setAgent({ evaluate: (fn) => fn() }, false);
        ok('reports failure instead of claiming success', !r.ok, JSON.stringify(r));
        ok('says what went wrong', /did not turn OFF/.test(String(r.why)), r.why);
    }

    console.log('\n--- no chip: setAgent refuses rather than pretending ---');
    t = fakePage(true, { missing: true });
    r = await G.setAgent(t.page, false);
    ok('reports it cannot find the chip', !r.ok && /not on the page/.test(String(r.why)), JSON.stringify(r));

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
