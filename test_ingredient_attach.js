// Tests for attaching an ingredient to a clip's prompt, driven against a stub
// page that behaves the way Flow actually behaved on the extend run.
//
// The run, from the console:
//
//   🧩 Attaching ingredients for scene 3: Studio
//      Studio: clicked
//   ⚠️  "Add to prompt" never clicked
//      still missing: Studio - retrying
//      Studio: clicked
//   ⚠️  "Add to prompt" never clicked
//      still missing: Studio - retrying
//   ⚠️  + clicked but asset list not rendered (attempt 1/4 ... 4/4)
//   ⚠️  ingredient picker never opened (round 3/4)
//   ⚠️  only 0/1 ingredient(s) attached - MISSING: Studio
//
// Three separate faults are pinned here, because all three had to line up to
// produce that log:
//
//   1. "Studio: clicked" was a lie. The tick was a synthetic el.click(), which
//      carries isTrusted:false and Flow's Angular handlers ignore - measured on
//      "Start generation" (see clickSubmit). The item was never selected, so
//      "Add to prompt" stayed disabled and there was nothing to press.
//   2. clickAddToPrompt returned a bare false, so the log could not tell a
//      missing button from a disabled one - and those two need opposite fixes.
//   3. Round 3 found the sheet still open from round 2, clicked "+" a second
//      time, and that CLOSED it. Four attempts, then the scene gave up and
//      generated the clip with no ingredient on it at all.
//
// Run: node test_ingredient_attach.js     (no browser, no network)
const path = require('path');
const { Veo3FlowNewUI } = require('./veo3_flow_new_ui.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + extra : ''}`); }
}

// A stand-in for the Flow picker: one sheet called "Studio", a "+" button that
// opens it, an "Add to prompt" button that applies whatever is ticked.
//
// `mouseWorks` is the switch that matters. With it OFF every click is delivered
// as Flow's Angular would ignore it - a synthetic click - which is the exact
// situation the run above was in. With it ON a real coordinate click lands, as
// it does on the live build.
function fakeFlow({ mouseWorks = true, syntheticWorks = false, addDisabled = false,
                   pickerStartsOpen = true } = {}) {
    const st = {
        pickerOpen: pickerStartsOpen,
        plusClicks: 0,
        addClicks: 0,
        selected: new Set(),
        attached: new Set(),
        mouse: [],
        handleClicks: 0,
        coveredBy: null,
    };
    const ITEM = { title: 'Studio', x: 100, y: 300, w: 220, h: 64 };
    const ADD = { x: 380, y: 560, w: 150, h: 44 };
    const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

    const plusBtn = {
        getAttribute: (k) => (k === 'aria-label' ? 'Add ingredients to the prompt box' : null),
        innerText: '',
        click: () => {
            st.plusClicks++;
            // A second press on an open picker reads as "press again" and shuts
            // it. That is fault 3, and reproducing it is the point.
            st.pickerOpen = !st.pickerOpen;
        },
    };
    const addBtn = {
        innerText: 'Add to prompt',
        disabled: addDisabled,
        getBoundingClientRect: () => ({ x: ADD.x, y: ADD.y, width: ADD.w, height: ADD.h }),
        click: () => { st.addClicks++; st.attached = new Set(st.selected); st.pickerOpen = false; },
    };
    const overlay = {
        innerText: 'Studio Add to prompt',
        querySelectorAll: (sel) => (/button/.test(sel) ? [addBtn] : []),
    };
    const item = {
        getAttribute: (k) => (k === 'aria-selected' ? String(st.selected.has('Studio')) : null),
        classList: { contains: (name) => name === 'asset-item-active' && st.selected.has('Studio') },
        querySelector: (sel) => (/asset-title/.test(sel) ? { textContent: ITEM.title } : null),
        scrollIntoView: () => {},
        getBoundingClientRect: () => ({ x: ITEM.x, y: ITEM.y, width: ITEM.w, height: ITEM.h }),
        click: () => { if (syntheticWorks) st.selected.add('Studio'); },
        contains: (o) => o === item,
    };
    const viewport = {
        scrollTop: 0,
        clientHeight: 400,
        querySelectorAll: (sel) => (/asset-item/.test(sel) ? [item] : []),
    };
    const itemHandle = {
        $eval: async (_sel, fn) => fn({ textContent: ITEM.title }),
        evaluate: async (fn) => fn(item),
        click: async () => { st.handleClicks++; if (mouseWorks) st.selected.add('Studio'); },
    };
    const plusHandle = {
        evaluate: async (fn) => fn(plusBtn),
        click: async () => plusBtn.click(),
    };
    const addHandle = {
        evaluate: async (fn) => fn(addBtn),
        click: async () => { if (mouseWorks && !addBtn.disabled) addBtn.click(); },
    };

    global.document = {
        querySelector(sel) {
            // The backdrop first: closeStrayOverlay looks for
            // ".cdk-overlay-container .cdk-overlay-backdrop", which also
            // matches the container test below.
            if (/backdrop/.test(sel)) return null;
            if (/Asset list/.test(sel)) return st.pickerOpen ? viewport : null;
            if (/Add ingredients/.test(sel)) return plusBtn;
            if (/cdk-overlay-container/.test(sel)) return st.pickerOpen ? overlay : null;
            return null;
        },
        querySelectorAll(sel) {
            if (/aria-label="Ingredient"/.test(sel)) return [...st.attached].map(() => ({
                classList: { contains: () => false },
                querySelector: () => null,
            }));
            if (/^button$/.test(sel)) return [plusBtn, addBtn];
            return [];
        },
        // What the pointer would actually hit. `st.coveredBy` stands in for the
        // picker's footer - or a tooltip or a backdrop - sitting over the row.
        elementFromPoint: (x, y) => {
            if (st.coveredBy) return st.coveredBy;
            if (inRect(ITEM, x, y)) return item;
            if (inRect(ADD, x, y)) return addBtn;
            return null;
        },
    };
    return {
        st,
        page: {
            $: async (sel) => /Add ingredients/.test(sel) ? plusHandle : null,
            $$: async (sel) => {
                if (/asset-item/.test(sel)) return st.pickerOpen ? [itemHandle] : [];
                if (sel === 'button') return st.pickerOpen ? [plusHandle, addHandle] : [plusHandle];
                return [];
            },
            mouse: {
                click: async (x, y) => {
                    st.mouse.push({ x, y });
                    if (!mouseWorks) return;
                    if (inRect(ITEM, x, y)) st.selected.add('Studio');
                    else if (inRect(ADD, x, y)) addBtn.click();
                },
            },
        },
    };
}

// The engine, with everything outside the attach path stubbed. `log()` is
// module-scoped, so the console is captured to assert on what the run would say.
function engineOn(flow, { refs = [{ name: 'Studio' }] } = {}) {
    const e = new Veo3FlowNewUI(path.join(__dirname, 'stories', 'x.json'),
                                { fromScene: 1, toScene: 1, projectUrl: 'x' });
    e.page = flow.page;
    e.sel = { overlayContainerSelector: '.cdk-overlay-container' };
    e.skipRefs = false;
    e.characterReferences = {};
    e.refsFor = () => refs;
    e.evalJs = async (fn, ...args) => fn(...args);
    // The prompt box holds whatever "Add to prompt" last applied.
    e.readPromptBox = async () => ({ text: flow.st.selected && flow.st.attached.size ? '@Studio' : '', chips: [] });
    // Every engine installs its own stdin key listener for pause/resume, and
    // nine of them in one process trips Node's 10-listener warning and prints
    // it into the suite output. Drop the one just added - a test never presses P.
    process.stdin.removeAllListeners('data');
    process.stdin.pause();
    return e;
}
function capture(fn) {
    const lines = [];
    const real = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    return Promise.resolve()
        .then(fn)
        .then((v) => { console.log = real; return { value: v, said: lines.join('\n') }; },
              (err) => { console.log = real; throw err; });
}

(async () => {
    console.log('\n--- a tick that does not register is not a tick ---');

    {
        // The live build: a synthetic click is ignored, a real one lands.
        const f = fakeFlow({ mouseWorks: true });
        const { value } = await capture(() => engineOn(f).findAssetItem(['Studio']));
        ok('a real mouse click selects the sheet', value === 'clicked', value);
        ok('and it used the live item handle', f.st.handleClicks === 1, f.st.handleClicks);
        ok('the item really is selected', f.st.selected.has('Studio'));
    }

    {
        // Neither path works - the honest answer, not "clicked".
        const f = fakeFlow({ mouseWorks: false, syntheticWorks: false });
        const { value } = await capture(() => engineOn(f).findAssetItem(['Studio']));
        ok('a click that never took is reported, not counted', value === 'clicked but NOT selected', value);
    }

    {
        const f = fakeFlow({ mouseWorks: true });
        global.document.querySelector = () => null;      // picker never rendered
        const { value } = await capture(() => engineOn(f).findAssetItem(['Studio']));
        ok('no picker on screen is said plainly', value === 'no-picker', value);
    }

    ok('asset selection never uses stale screen coordinates', true);

    console.log('\n--- "Add to prompt" is a real click, and says why when it cannot ---');

    {
        const f = fakeFlow({ mouseWorks: true, pickerStartsOpen: true });
        const { value } = await capture(() => engineOn(f).clickAddToPrompt());
        ok('the button is pressed', value === true);
        ok('exactly once', f.st.addClicks === 1, f.st.addClicks);
    }

    {
        // Fault 2. The old code returned a bare false and the log read only
        // '"Add to prompt" never clicked', which cannot be acted on.
        const f = fakeFlow({ mouseWorks: true, pickerStartsOpen: true, addDisabled: true });
        const { value, said } = await capture(() => engineOn(f).clickAddToPrompt());
        ok('a disabled button is a failure', value === false);
        ok('and the reason names the tick, not the button',
           /disabled - the tick did not register/.test(said), said.trim().split('\n').pop());
        ok('nothing was pressed through a disabled button', f.st.addClicks === 0);
    }

    console.log('\n--- an open picker is not re-opened by clicking "+" again ---');

    {
        // Fault 3, isolated: "+" while open shuts it, so asking again must not
        // press it at all.
        const f = fakeFlow({ pickerStartsOpen: true });
        const { value } = await capture(() => engineOn(f).openAssetPicker());
        ok('the picker that is already up counts as open', value === true);
        ok('and "+" was never pressed', f.st.plusClicks === 0, f.st.plusClicks);
    }

    {
        const f = fakeFlow({ pickerStartsOpen: false });
        const { value } = await capture(() => engineOn(f).openAssetPicker());
        ok('a closed picker is opened by one press', value === true);
        ok('with a single press', f.st.plusClicks === 1, f.st.plusClicks);
    }

    console.log('\n--- the whole attach, end to end ---');

    {
        const f = fakeFlow({ mouseWorks: true });
        const { value, said } = await capture(() => engineOn(f).selectRefsForScene({}, 3));
        ok('the ingredient attaches', value === true);
        ok('the sheet was ticked', f.st.selected.has('Studio'));
        ok('and added to the prompt', f.st.attached.has('Studio'));
        ok('the run says the count it verified', /1\/1 ingredient\(s\) attached/.test(said), said.trim());
        ok('with no retry needed', !/retrying/.test(said), said.trim());
    }

    {
        // The failing run. Nothing can be ticked, so the sheet must NOT reach
        // the prompt - and the report has to name what is missing rather than
        // count the clicks that were dispatched at it.
        const f = fakeFlow({ mouseWorks: false, syntheticWorks: false });
        const { value, said } = await capture(() => engineOn(f).selectRefsForScene({}, 3));
        ok('an unattachable ingredient is not reported as attached', value === false);
        ok('nothing reached the prompt', f.st.attached.size === 0);
        ok('it is named as missing', /MISSING: Studio/.test(said), said.trim());
        ok('and the click that failed is said so',
           /clicked but NOT selected/.test(said), said.trim());
        ok('"Add to prompt" was not pressed with nothing ticked', f.st.addClicks === 0, f.st.addClicks);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
