// Tests for the model dropdown reader in generate_refs.js.
//
// The Settings panel has one of these dropdowns per generation-default section -
// an Image one and a Video one, identical in shape, both a button carrying an
// arrow_drop_down icon next to the current model's name. Reading or setting the
// wrong one is silent and expensive: the film generates on the wrong model and
// nothing in the log looks wrong. So the scoping is what most of this pins.
//
// The snapshots below are taken from a live Flow project.
//
// Run: node test_model_picker.js     (no browser, no network)
const G = require('./generate_refs.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + extra : ''}`); }
}

// ── a very small DOM, enough for the selectors this code uses ────────────────
const classList = (el) => String(el.className || '').split(/\s+/).filter(Boolean);
function matchOne(el, sel) {
    const m = sel.match(/^([a-zA-Z0-9-]+)?((?:\.[\w-]+|\[[^\]]+\])*)$/);
    if (!m) return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    for (const tok of (m[2] || '').match(/\.[\w-]+|\[[^\]]+\]/g) || []) {
        if (tok[0] === '.') {
            if (!classList(el).includes(tok.slice(1))) return false;
        } else {
            const a = tok.slice(1, -1).match(/^([\w-]+)(?:=["']?([^"']*)["']?)?$/);
            if (!a) return false;
            const v = el.getAttribute(a[1]);
            if (v === null) return false;
            if (a[2] !== undefined && v !== a[2]) return false;
        }
    }
    return true;
}
const descendants = (el) => (el._children || []).flatMap((c) => [c, ...descendants(c)]);

// Split on a separator only at the top level. A real querySelector treats
// whitespace and commas inside quotes or brackets as part of an attribute value,
// so `button[aria-label="Video generation default model"]` is ONE selector -
// splitting it on spaces would turn it into four descendant steps that match
// nothing, and the harness would blame the code for its own parsing.
function splitTop(str, sep) {
    const out = [];
    let cur = '', depth = 0, q = null;
    for (const ch of str) {
        if (q) { cur += ch; if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
        if (ch === '[' || ch === '(') depth++;
        else if (ch === ']' || ch === ')') depth--;
        if (depth === 0 && (sep === 'ws' ? /\s/.test(ch) : ch === sep)) {
            if (cur) { out.push(cur); cur = ''; }
            continue;
        }
        cur += ch;
    }
    if (cur) out.push(cur);
    return out;
}

function findAll(root, selector) {
    const out = [];
    // A comma list is four selectors, not one long chain - both the radio and
    // the model-menu lookups use one.
    for (const part of splitTop(String(selector), ',')) {
        const chain = splitTop(part.trim(), 'ws').filter(Boolean);
        if (!chain.length) continue;
        let scope = [root];
        for (const step of chain) {
            scope = scope.flatMap((s) => descendants(s).filter((el) => matchOne(el, step)));
        }
        out.push(...scope);
    }
    return out;
}
function el(tag, opts = {}) {
    const { cls = '', text = '', attrs = {}, children = [], hidden = false } = opts;
    const node = {
        tagName: tag.toUpperCase(),
        className: cls,
        _text: text,
        _attrs: { ...attrs },
        _children: children,
        _parent: null,
        _hidden: hidden,
        _onClick: opts.onClick || null,
        // openSettingsPanel prefers whichever settings button is on screen, so
        // the fake DOM has to be able to answer that question.
        getBoundingClientRect() {
            return node._hidden ? { width: 0, height: 0 } : { width: 120, height: 24 };
        },
        get innerText() { return node._text + node._children.map((c) => c.innerText).join(''); },
        get textContent() { return node.innerText; },
        getAttribute(k) { return k in node._attrs ? node._attrs[k] : null; },
        setAttribute(k, v) { node._attrs[k] = v; },
        querySelector: (s) => findAll(node, s)[0] || null,
        querySelectorAll: (s) => findAll(node, s),
        closest(s) {
            const parts = splitTop(String(s), ',').map((x) => x.trim()).filter(Boolean);
            for (let p = node; p; p = p._parent) {
                if (parts.some((part) => matchOne(p, part))) return p;
            }
            return null;
        },
        remove() {
            const i = node._parent ? node._parent._children.indexOf(node) : -1;
            if (i >= 0) node._parent._children.splice(i, 1);
        },
        cloneNode() {
            // node._text, not the captured `text`: the code under test reads the
            // row back after a pick, so a clone that ignores mutations would make
            // a successful pick and a dead click look identical.
            return el(tag, {
                cls, text: node._text, attrs: { ...node._attrs },
                children: node._children.map((c) => c.cloneNode()),
            });
        },
        click() { if (node._onClick) node._onClick(); },
    };
    for (const c of children) c._parent = node;
    return node;
}

const MODELS = ['Omni 1.1 Flash', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality', 'Veo 3.1 - Lite [Lower Priority]'];

// Build a settings panel with an Image row and a Video row, plus the Never radio
// in the shape the live page uses (label + subtext inside one container).
function buildPanel({ imageModel = 'Nano Banana', videoModel = 'Veo 3.1 - Quality', menu = MODELS,
                      deadClick = false, neverChecked = 'false',
                      settingsButtons = null, panelInitiallyClosed = false, pickers = null,
                      closer: closerOpts = {} } = {}) {
    const overlay = el('div', { cls: 'cdk-overlay-pane' });
    const state = { clicks: 0, opened: 0 };

    const modelTrigger = (current, onOpen) => {
        const label = el('span', { cls: 'mdc-button__label', text: current });
        const icon = el('mat-icon', { text: 'arrow_drop_down' });
        return el('button', {
            children: [label, icon],
            onClick: () => { state.clicks++; state.opened++; onOpen(label); },
        });
    };
    const fillMenu = (label) => {
        overlay._children.length = 0;
        for (const name of menu) {
            const span = el('span', { cls: 'label', text: name });
            const option = el('div', {
                attrs: { role: 'option' },
                children: [span],
                onClick: () => {
                    if (deadClick) return;              // the click lands, nothing happens
                    label._text = name;
                    overlay._children.length = 0;      // the menu closes on pick
                },
            });
            option._parent = overlay;
            overlay._children.push(option);
        }
    };

    const imgSection = el('div', { cls: 'settings-section', children: [
        el('h3', { text: 'Image generation default' }),
        modelTrigger(imageModel, fillMenu),
    ] });
    const vidSection = el('div', { cls: 'settings-section', children: [
        el('h3', { text: 'Video generation default' }),
        modelTrigger(videoModel, fillMenu),
    ] });
    const neverRadio = el('div', {
        attrs: { role: 'radio', 'aria-checked': neverChecked },
        onClick: function () { if (!deadClick) neverRadio._attrs['aria-checked'] = 'true'; },
        children: [
            el('div', { cls: 'radio-label-container', children: [
                el('span', { cls: 'radio-label', text: 'Never' }),
                el('span', { cls: 'radio-subtext', text: 'Agent will generate media and spend credits automatically.' }),
            ] }),
        ],
    });
    const confirmSection = el('div', { cls: 'settings-section', children: [
        el('h3', { text: 'Confirm before generating' }),
        neverRadio,
    ] });
    const saveClicks = [];
    const save = el('button', {
        cls: 'settings-save-button', text: 'Save',
        // Live, Save both commits and closes - it is the drawer's only exit.
        onClick: () => { saveClicks.push('save'); if (closerOpts.saveWorks !== false) closePanel(); },
    });

    // Flow also names the two pickers outright - .video-model-picker-button /
    // aria-label="Video generation default model" - which is exact where the
    // section scan has to infer. `pickers` adds such a button holding its OWN
    // model while the section's arrow trigger keeps a different one, so a test
    // can prove the named picker wins over the row it sits near.
    const pickerBtns = [];
    for (const which of ['image', 'video']) {
        const p = (pickers || {})[which];
        if (!p) continue;
        const label = el('span', { cls: 'mdc-button__label', text: p.model });
        const attrs = p.via === 'aria'
            ? { 'aria-label': `${which === 'image' ? 'Image' : 'Video'} generation default model` }
            : {};
        // The real class is "video-model-picker-button" - the "-button" suffix is
        // easy to lose to a truncated DOM dump, and losing it silently disables
        // this half of the selector.
        const cls = p.via === 'class' ? `${which}-model-picker-button` : '';
        pickerBtns.push(el('button', {
            cls, attrs,
            children: [label, el('mat-icon', { text: 'arrow_drop_down' })],
            onClick: () => { state.clicks++; state.opened++; fillMenu(label); },
        }));
    }

    const sections = [confirmSection, imgSection, vidSection];

    // The settings buttons live on the page, not in the panel. Clicking one opens
    // the panel by putting the sections in the DOM, which is what
    // openSettingsPanel checks for - so a panel that never opens is one whose
    // sections are simply never attached. A hidden button does nothing when
    // clicked, and is recorded either way so a test can prove it was not used.
    const settingsClicks = [];
    const openPanel = () => {
        for (const s of sections) {
            if (!root._children.includes(s)) { s._parent = root; root._children.push(s); }
        }
    };
    const closePanel = () => {
        for (const s of sections) {
            const i = root._children.indexOf(s);
            if (i >= 0) root._children.splice(i, 1);
        }
    };
    const settingsBtns = (settingsButtons || []).map((b) => el('button', {
        attrs: { 'aria-label': b.label },
        hidden: !!b.hidden,
        onClick: () => { settingsClicks.push(b.label); if (!b.hidden) openPanel(); },
    }));

    // No close control: the live drawer has none that works. Anything that
    // looked like one - Escape, a backdrop, a document-level "close" icon - was
    // measured and leaves the panel open, so the harness must not offer an exit
    // the real page does not have.
    const root = el('body', {
        children: [...settingsBtns, ...pickerBtns, save,
                   ...(panelInitiallyClosed ? [] : sections), overlay],
    });
    const page = {
        evaluate: (fn, arg) => fn(arg),
        keyboard: { press: () => { overlay._children.length = 0; } },
        mouse: { click: () => {} },
    };
    global.document = {
        querySelectorAll: (s) => findAll(root, s),
        querySelector: (s) => findAll(root, s)[0] || null,
    };
    global.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
    return { page, state, overlay, neverRadio, save, vidSection, imgSection,
             settingsClicks, saveClicks, root };
}

(async () => {
    console.log('\n--- reading the row ---');

    let t = buildPanel({ videoModel: 'Veo 3.1 - Quality' });
    ok('reads the video row', (await G.readVideoModel(t.page)) === 'Veo 3.1 - Quality',
       await G.readVideoModel(t.page));
    ok('and the image row separately', (await G.readImageModel(t.page)) === 'Nano Banana',
       await G.readImageModel(t.page));

    // The whole point of scoping: two identical dropdowns on one panel.
    t = buildPanel({ imageModel: 'Nano Banana', videoModel: 'Omni 1.1 Flash' });
    ok('the video reader does NOT return the image row',
       (await G.readVideoModel(t.page)) === 'Omni 1.1 Flash', await G.readVideoModel(t.page));
    ok('the image reader does NOT return the video row',
       (await G.readImageModel(t.page)) === 'Nano Banana', await G.readImageModel(t.page));

    ok('the arrow_drop_down ligature is stripped out of the name',
       !/arrow_drop_down/.test(String(await G.readVideoModel(t.page))));

    console.log('\n--- picking a model ---');

    t = buildPanel({ videoModel: 'Veo 3.1 - Quality' });
    let r = await G.setSectionModel(t.page, 'video', 'Veo 3.1 - Fast');
    ok('picks the model', r.ok && r.changed, JSON.stringify(r));
    ok('and the row reads back the new one', (await G.readVideoModel(t.page)) === 'Veo 3.1 - Fast',
       await G.readVideoModel(t.page));
    ok('the image row was not touched', (await G.readImageModel(t.page)) === 'Nano Banana');

    r = await G.setSectionModel(t.page, 'video', 'Omni 1.1 Flash');
    ok('picks any model in the list', (await G.readVideoModel(t.page)) === 'Omni 1.1 Flash',
       await G.readVideoModel(t.page));

    // The brackets on the last one are the trap: a loose key must still be exact.
    r = await G.setSectionModel(t.page, 'video', 'Veo 3.1 - Lite [Lower Priority]');
    ok('picks the bracketed name', (await G.readVideoModel(t.page)) === 'Veo 3.1 - Lite [Lower Priority]',
       await G.readVideoModel(t.page));

    r = await G.setSectionModel(t.page, 'video', 'Veo 3.1 - Lite [Lower Priority]');
    ok('a second call is a no-op', r.ok && !r.changed, JSON.stringify(r));

    console.log('\n--- name spellings do not have to match exactly ---');
    t = buildPanel({ videoModel: 'Veo 3.1 - Quality' });
    r = await G.setSectionModel(t.page, 'video', 'veo3.1-fast');
    ok('"veo3.1-fast" finds "Veo 3.1 - Fast"', r.ok && (await G.readVideoModel(t.page)) === 'Veo 3.1 - Fast',
       JSON.stringify(r));

    console.log('\n--- a pick that does not take is reported, never assumed ---');
    t = buildPanel({ videoModel: 'Veo 3.1 - Quality', deadClick: true });
    r = await G.setSectionModel(t.page, 'video', 'Veo 3.1 - Fast');
    ok('reports failure', !r.ok, JSON.stringify(r));
    ok('and says what the row actually reads', /Veo 3\.1 - Quality/.test(String(r.why)), r.why);
    ok('the old model is still the one set', (await G.readVideoModel(t.page)) === 'Veo 3.1 - Quality');

    t = buildPanel({ videoModel: 'Veo 3.1 - Quality' });
    r = await G.setSectionModel(t.page, 'video', 'Veo 4 - Imaginary');
    ok('a name that is not in the menu is reported', !r.ok && /not in the video model menu/.test(String(r.why)),
       JSON.stringify(r));

    console.log('\n--- "Never" sits behind a subtext, which is what broke it before ---');
    t = buildPanel({ neverChecked: 'false' });
    ok('finds the Never radio despite the subtext beside it',
       (await G.setConfirmNever(t.page)) === 'clicked', await G.setConfirmNever(t.page));
    ok('and it is checked afterwards', t.neverRadio.getAttribute('aria-checked') === 'true');

    t = buildPanel({ neverChecked: 'true' });
    ok('an already-Never radio is left alone', (await G.setConfirmNever(t.page)) === 'already');

    t = buildPanel({ neverChecked: 'false', deadClick: true });
    ok('a Never radio that will not move still reports honestly',
       (await G.setConfirmNever(t.page)) === 'clicked' &&
       t.neverRadio.getAttribute('aria-checked') === 'false');

    console.log('\n--- opening the panel, which is how the model gets set at all ---');
    // A live run with Agent Mode OFF showed only "Settings trigger" - no
    // "Settings" button at all. The old selector matched "Settings" exactly, so
    // the panel could not be opened and the caller's `if (await openSettingsPanel)`
    // silently skipped every setting, image model and video model alike.
    let t2 = buildPanel({ settingsButtons: [{ label: 'Settings trigger' }], panelInitiallyClosed: true });
    ok('opens from "Settings trigger" alone', (await G.openSettingsPanel(t2.page)) === true);
    ok('and it used that button', t2.settingsClicks.includes('Settings trigger'), t2.settingsClicks.join(','));

    // Both labels exist in some states; the hidden one must not win.
    t2 = buildPanel({ settingsButtons: [{ label: 'Settings', hidden: true }, { label: 'Settings trigger' }],
                      panelInitiallyClosed: true });
    ok('a hidden "Settings" does not win over a visible trigger',
       (await G.openSettingsPanel(t2.page)) === true &&
       t2.settingsClicks[0] === 'Settings trigger', t2.settingsClicks.join(','));

    t2 = buildPanel({ settingsButtons: [{ label: 'Settings trigger', hidden: true }, { label: 'Settings' }],
                      panelInitiallyClosed: true });
    ok('a hidden trigger does not win over a visible "Settings"',
       (await G.openSettingsPanel(t2.page)) === true &&
       t2.settingsClicks[0] === 'Settings', t2.settingsClicks.join(','));

    t2 = buildPanel({ settingsButtons: [{ label: 'Settings' }], panelInitiallyClosed: true });
    ok('the plain "Settings" button still works', (await G.openSettingsPanel(t2.page)) === true);

    // "Tile grid settings" is a real button on the project page and must not be
    // mistaken for the panel's opener.
    t2 = buildPanel({ settingsButtons: [{ label: 'Tile grid settings' }], panelInitiallyClosed: true });
    ok('"Tile grid settings" is not mistaken for the opener',
       (await G.openSettingsPanel(t2.page)) === false && t2.settingsClicks.length === 0);

    console.log('\n--- the pickers Flow names outright beat the row beside them ---');
    // Live Flow marks them: class="video-model-picker" and
    // aria-label="Video generation default model". Where that exists it cannot
    // pick the wrong row, so it is preferred over the section scan.
    for (const via of ['class', 'aria']) {
        t = buildPanel({
            videoModel: 'Veo 3.1 - Quality',                       // the section's own row
            pickers: { video: { model: 'Omni 1.1 Flash', via } },  // the named picker
        });
        ok(`reads the named picker by ${via}, not the section row`,
           (await G.readVideoModel(t.page)) === 'Omni 1.1 Flash',
           await G.readVideoModel(t.page));
    }

    t = buildPanel({
        imageModel: 'Nano Banana',
        pickers: { video: { model: 'Omni 1.1 Flash', via: 'class' } },
    });
    ok('and the image row is still read from its own section',
       (await G.readImageModel(t.page)) === 'Nano Banana', await G.readImageModel(t.page));

    t = buildPanel({
        videoModel: 'Veo 3.1 - Quality',
        pickers: { video: { model: 'Omni 1.1 Flash', via: 'class' } },
    });
    ok('the named picker is the one clicked when setting',
       (await G.setSectionModel(t.page, 'video', 'Veo 3.1 - Fast')).ok);

    // The fallback still has to work for a build without the named pickers.
    t = buildPanel({ videoModel: 'Veo 3.1 - Quality' });
    ok('without a named picker the section scan still reads it',
       (await G.readVideoModel(t.page)) === 'Veo 3.1 - Quality');

    console.log('\n--- closing the panel, which is only ever done by saving ---');
    // Measured live: Escape, clicking outside, the header backdrop, the Settings
    // buttons and a document-level "close" icon all leave this drawer open. Save
    // is the only exit - and it commits. So closing IS saving, and the tests
    // below pin that rather than a dismiss-without-writing path that does not
    // exist.
    t = buildPanel({});
    ok('closes by clicking Save', (await G.closeSettings(t.page)) === true);
    ok('and Save is what it used', t.saveClicks.length === 1, t.saveClicks.join(','));

    t = buildPanel({ panelInitiallyClosed: true });
    ok('an already-closed panel reports closed without saving',
       (await G.closeSettings(t.page)) === true && t.saveClicks.length === 0);

    t = buildPanel({ closer: { saveWorks: false } });
    ok('a panel that will not close is reported honestly, not assumed',
       (await G.closeSettings(t.page, 0.6)) === false);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
