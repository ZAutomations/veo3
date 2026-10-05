// Tests for the narrator's voice: which one a story gets, and the picker walk
// that puts it on a clip.
//
// The run this exists for: the preset says `flow_voice: "Alnilam"`, the film
// came back narrated by three different people, and the extend engine - which
// generates one clip at a time - never named a voice on any of them. A voice in
// Flow is an ASSET ON THE PROMPT BOX, not a setting on the project, so "the
// preset says Alnilam" is worth exactly nothing until something attaches it to
// each generation.
//
// The walk itself is ported from agent_mode.js, where it is measured working,
// so these tests pin the SHAPE of it rather than re-deriving it:
//   "+" (real click) -> Voices filter -> scan the rows -> REAL click the row
//   -> "Add to prompt" -> Escape
// plus the two things the port added: it reads the voice back off the prompt
// box, and it says so when the press did not land.
//
// Run: node test_voice_attach.js     (no browser, no network)
const path = require('path');
const fs = require('fs');
const { Veo3FlowNewUI } = require('./veo3_flow_new_ui.js');
const { presetVoices, resolveFlowVoice, attachVoice, voiceOnPromptBox } = require('./flow_voice.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + extra : ''}`); }
}
// Every wait in this suite resolves at once: the sequence is what is under
// test, not the pacing.
const nowait = async () => {};

// A stand-in for Flow's assets picker, as the voice walk uses it:
//   + -> a menu with a search box and a "Voices" filter -> rows -> a detail
//   pane whose button adds the armed row to the prompt box.
function fakePage(opts = {}) {
    const cfg = Object.assign({
        voices: ['Alnilam', 'Fenrir', 'Kore'],
        menuOpens: true,
        // 'always'      - the rows are listed as soon as Voices is picked
        // 'search-only' - the list stays empty until something is typed, which
        //                 is what makes the search box the fallback rather than
        //                 the first move
        rowsWhen: 'always',
        addButton: true,
        addLands: true,
    }, opts);

    const st = {
        menuOpen: false, category: 'images', search: '', focused: null,
        armed: null, chips: [], escapes: 0, clicks: [], typed: [],
    };

    const PLUS = { x: 10, y: 10, w: 32, h: 32 };
    const SEARCH = { x: 200, y: 60, w: 300, h: 36 };
    const FILTER = { x: 20, y: 120, w: 90, h: 36 };
    const ADD = { x: 400, y: 700, w: 160, h: 40 };
    const rowRect = (i) => ({ x: 20, y: 200 + i * 40, w: 250, h: 36 });
    const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

    const rows = () => {
        if (!st.menuOpen || st.category !== 'voices') return [];
        if (cfg.rowsWhen === 'search-only' && !st.search) return [];
        const q = st.search.toLowerCase();
        return cfg.voices.filter((v) => !q || v.toLowerCase().startsWith(q));
    };

    const plusBtn = {
        innerText: '',
        getAttribute: (k) => (k === 'aria-label' ? 'Add ingredients to the prompt box' : null),
        querySelector: (sel) => (/add-menu-icon/.test(sel) ? {} : null),
        scrollIntoView: () => {},
        getBoundingClientRect: () => ({ x: PLUS.x, y: PLUS.y, width: PLUS.w, height: PLUS.h }),
        click: () => { throw new Error('the voice walk must use a REAL click, not .click()'); },
    };
    const filterBtn = { innerText: 'Voices', click: () => { st.category = 'voices'; } };
    const searchInput = {
        getAttribute: (k) => (k === 'aria-label' ? 'Search assets' : (k === 'placeholder' ? 'Search assets' : null)),
        get value() { return st.search; },
        getBoundingClientRect: () => ({ x: SEARCH.x, y: SEARCH.y, width: SEARCH.w, height: SEARCH.h }),
    };
    const addBtn = {
        innerText: 'Add to prompt',
        getBoundingClientRect: () => ({ x: ADD.x, y: ADD.y, width: ADD.w, height: ADD.h }),
    };
    const rowEls = () => rows().map((name, i) => ({
        innerText: `${name} voice_selection`,
        scrollIntoView: () => {},
        getBoundingClientRect: () => {
            const r = rowRect(i);
            return { x: r.x, y: r.y, width: r.w, height: r.h };
        },
    }));
    const promptBox = {
        get innerText() { return 'The egg is not a shape. It is a decision. ' + st.chips.join(' '); },
        get textContent() { return 'The egg is not a shape. It is a decision. ' + st.chips.join(' '); },
        querySelectorAll: () => [],
    };

    global.document = {
        querySelector(sel) {
            if (/Asset list/.test(sel)) return null;
            if (/detail-add-to/.test(sel)) return st.menuOpen && st.armed && cfg.addButton ? addBtn : null;
            if (/Search assets/.test(sel)) return st.menuOpen ? searchInput : null;
            if (/ProseMirror/.test(sel)) return promptBox;
            if (/cdk-overlay-pane/.test(sel)) return null;
            return null;
        },
        querySelectorAll(sel) {
            if (/^button$/.test(sel)) {
                return st.menuOpen && st.armed && cfg.addButton ? [plusBtn, addBtn] : [plusBtn];
            }
            if (/mat-list-item/.test(sel)) return st.menuOpen ? [filterBtn] : [];
            if (/asset-item/.test(sel)) return rowEls();
            if (/^input$/.test(sel)) return st.menuOpen ? [searchInput] : [];
            return [];
        },
    };

    // The pointer. Only what is genuinely on screen can be hit - which is how a
    // coordinate click behaves, and why the rects above are part of the fixture.
    const hit = (x, y) => {
        if (inRect(PLUS, x, y)) return { kind: 'plus' };
        if (!st.menuOpen) return null;
        if (inRect(SEARCH, x, y)) return { kind: 'search' };
        if (inRect(FILTER, x, y)) return { kind: 'filter' };
        const names = rows();
        for (let i = 0; i < names.length; i++) {
            if (inRect(rowRect(i), x, y)) return { kind: 'row', name: names[i] };
        }
        if (st.armed && cfg.addButton && inRect(ADD, x, y)) return { kind: 'add' };
        return null;
    };

    return {
        st,
        page: {
            mouse: {
                click: async (x, y) => {
                    const h = hit(x, y);
                    st.clicks.push(h ? h.kind : 'miss');
                    if (!h) return;
                    if (h.kind === 'plus') { st.menuOpen = cfg.menuOpens; return; }
                    if (h.kind === 'search') { st.focused = 'search'; return; }
                    if (h.kind === 'filter') { st.category = 'voices'; return; }
                    if (h.kind === 'row') { st.armed = h.name; return; }
                    if (h.kind === 'add') {
                        if (cfg.addLands) st.chips.push(st.armed);
                        st.menuOpen = false;
                    }
                },
            },
            keyboard: {
                press: async (key) => {
                    if (key === 'Escape') { st.escapes++; st.menuOpen = false; st.armed = null; st.focused = null; }
                    if (key === 'Backspace' && st.focused === 'search') st.search = '';
                },
                down: async () => {},
                up: async () => {},
                type: async (text) => {
                    st.typed.push(text);
                    if (st.focused === 'search') st.search += text;
                },
            },
            evaluate: async (fn, arg) => fn(arg),
        },
    };
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

// The engine, with everything outside the voice path stubbed.
function engineOn(f, opts = {}) {
    const e = new Veo3FlowNewUI(path.join(__dirname, 'stories', 'x.json'),
                                { fromScene: 1, toScene: 1, projectUrl: 'x' });
    e.page = f.page;
    e.sel = { overlayContainerSelector: '.cdk-overlay-container' };
    e.skipRefs = false;
    e.noVoice = false;
    e.flowVoice = opts.flowVoice === undefined ? { name: 'Alnilam', source: 'test' } : opts.flowVoice;
    process.stdin.removeAllListeners('data');
    process.stdin.pause();
    const realWait = global.wait;
    return { e, realWait };
}

// The stories get tidied into stories/old and stories/old2 once a film is
// finished, so the story is looked for rather than assumed to be in one place.
// The point of this test is that a story ALREADY WRITTEN resolves its voice from
// the preset label alone - the folder it is filed under does not matter.
const STORY_NAME = 'the_secret_behind_egg_shapes';
const STORY_FILE = [
    path.join(__dirname, 'stories', STORY_NAME),
    path.join(__dirname, 'stories', 'old', STORY_NAME),
    path.join(__dirname, 'stories', 'old2', STORY_NAME),
].map((d) => path.join(d, `${STORY_NAME}_story.json`))
 .find((f) => fs.existsSync(f));

(async () => {
    console.log('\n--- which voice a story is narrated in ---');
    if (STORY_FILE) {
        const story = JSON.parse(fs.readFileSync(STORY_FILE, 'utf8'));
        const r = resolveFlowVoice(story);
        ok('the film\'s own preset supplies the voice', r && r.name === 'Alnilam', JSON.stringify(r));
        ok('and the log can say where it came from', /Zack D\. style/.test(r.source), r.source);
        ok('with no edit to the story file itself', story.flow_voice === undefined);
    } else {
        ok(`a written story is on disk to check against (${STORY_NAME})`, false);
    }
    {
        ok('a voice written on the story wins over the preset',
           resolveFlowVoice({ flow_voice: 'Fenrir', niche: '3D Shorts (Zack D. style)' }).name === 'Fenrir');
        ok('a list of voices takes the first', resolveFlowVoice({ flow_voices: ['Kore', 'Fenrir'] }).name === 'Kore');
        ok('an unknown preset resolves to nothing', resolveFlowVoice({ niche: 'no such preset' }) === null);
        ok('and so does a story that is not there', resolveFlowVoice(null) === null);
    }
    {
        ok('presetVoices finds a preset by id', presetVoices('3d-zack-style')[0] === 'Alnilam');
        ok('by label too', presetVoices('3D Shorts (Zack D. style)')[0] === 'Alnilam');
        ok('an unknown preset asks for nothing', presetVoices('nope').length === 0);
        ok('and so does no preset at all', presetVoices(undefined).length === 0);
        ok('a preset with no voice asks for nothing', presetVoices('3d-moral-story').length === 1);
    }

    console.log('\n--- attaching it, the way Agent Mode does ---');
    {
        const f = fakePage();
        const { value, said } = await capture(() => attachVoice(f.page, 'Alnilam', { log: () => {}, wait: nowait }));
        ok('the voice attaches', value === true);
        ok('it is on the prompt box', f.st.chips.includes('Alnilam'));
        ok('the list was scanned, not searched', f.st.search === '', JSON.stringify(f.st.search));
        ok('the row was clicked with the mouse, not .click()', f.st.clicks.includes('row'), JSON.stringify(f.st.clicks));
        ok('and the add button too', f.st.clicks.includes('add'));
        ok('the stray menu was cleared first', f.st.escapes >= 1);
    }
    {
        // The fallback. A picker that lists nothing until something is typed is
        // exactly the case the search box is kept for.
        const f = fakePage({ rowsWhen: 'search-only' });
        const said = [];
        const { value } = await capture(() => attachVoice(f.page, 'Fenrir', { log: (m) => said.push(m), wait: nowait }));
        ok('a list that only fills on a search still attaches', value === true, said.join('\n'));
        ok('it says the list was empty before the search', said.some((l) => /0 item\(s\) before search/.test(l)), said.join(' '));
        ok('and it typed something to find it', f.st.typed.length === 1 && f.st.typed[0].length >= 3, JSON.stringify(f.st.typed));
    }

    console.log('\n--- and saying so when it does not ---');
    {
        const f = fakePage({ menuOpens: false });
        const said = [];
        const { value } = await capture(() => attachVoice(f.page, 'Alnilam', { log: (m) => said.push(m), wait: nowait }));
        ok('a menu that never opens is a failure', value === false);
        ok('and it is named as the reason', said.some((l) => /ingredients menu did not open/.test(l)), said.join(' '));
        ok('after all three attempts', said.filter((l) => /did not open/.test(l)).length === 3);
        ok('nothing was typed into the prompt', f.st.chips.length === 0);
    }
    {
        const f = fakePage({ voices: ['Fenrir', 'Kore'] });
        const said = [];
        const { value } = await capture(() => attachVoice(f.page, 'Alnilam', { log: (m) => said.push(m), wait: nowait }));
        ok('a voice that is not in the library is a failure', value === false);
        ok('the search box is read back in the same line', said.some((l) => /searchVal="Alni"/.test(l)), said.join(' '));
        ok('and what the picker held is printed with it', said.some((l) => /listed=\[/.test(l)));
    }
    {
        const f = fakePage({ addButton: false });
        const said = [];
        const { value } = await capture(() => attachVoice(f.page, 'Alnilam', { log: (m) => said.push(m), wait: nowait }));
        ok('a row that arms no add button is a failure', value === false);
        ok('said as "selected, but Add-to-prompt not found"',
           said.some((l) => /selected, but Add-to-prompt not found/.test(l)), said.join(' '));
        ok('the row WAS selected - so it reports what it saw, not what it wanted',
           said.some((l) => /selected voice: Alnilam/.test(l)), said.join(' '));
    }
    {
        // The row arms, the button is pressed, and the voice still does not
        // reach the prompt box. Reporting success here is the bug the whole
        // readback exists for - and pressing again could double the voice, so
        // it must not.
        const f = fakePage({ addLands: false });
        const said = [];
        const { value } = await capture(() => attachVoice(f.page, 'Alnilam', { log: (m) => said.push(m), wait: nowait }));
        ok('a press that does not land is not reported as an attach', value === false);
        ok('it says the press went in but the voice is not on the box',
           said.some((l) => /pressed onto the prompt but is not visible/.test(l)), said.join(' '));
        ok('and it does not press a second time', f.st.clicks.filter((c) => c === 'add').length === 1,
           JSON.stringify(f.st.clicks));
        ok('nothing reached the prompt box', f.st.chips.length === 0);
        ok('with no voice named at all it does nothing', await attachVoice(f.page, '', { log: () => {}, wait: nowait }) === false);
    }
    {
        const f = fakePage();
        const said = [];
        const { value } = await capture(() => attachVoice(f.page, 'Alnilam', { log: (m) => said.push(m), wait: nowait, attempts: 1 }));
        ok('one attempt means one attempt', value === true && said.length >= 1);
    }
    {
        const f = fakePage({ addButton: false });
        const said = [];
        await capture(() => attachVoice(f.page, 'Alnilam', { log: (m) => said.push(m), wait: nowait, attempts: 2 }));
        ok('an attach that never lands gives up and says how many tries',
           said.some((l) => /could not attach voice "Alnilam" after 2 attempts/.test(l)), said.join(' '));
    }

    console.log('\n--- the readback itself ---');
    {
        const f = fakePage();
        f.st.chips.push('Alnilam');
        ok('a voice on the box is seen', await voiceOnPromptBox(f.page, 'Alnilam', { wait: nowait }) === true);
        ok('one that is not there is not seen', await voiceOnPromptBox(f.page, 'Fenrir', { wait: nowait }) === false);
        ok('and spelling/case do not decide it', await voiceOnPromptBox(f.page, 'alnilam', { wait: nowait }) === true);
        global.document.querySelector = () => null;   // no prompt box on screen
        ok('no prompt box at all is not a false positive',
           await voiceOnPromptBox(f.page, 'Alnilam', { wait: nowait }) === false);
    }

    console.log('\n--- the engine puts it on EVERY clip ---');
    {
        const f = fakePage();
        const { e } = engineOn(f);
        const { value, said } = await capture(() => e.attachVoiceToScene(3));
        ok('scene 3 gets the voice', value === true);
        ok('and the log names it', /Attaching voice "Alnilam" for scene 3/.test(said), said.trim());
        ok('and confirms it landed', /"Alnilam" is on the scene 3 prompt/.test(said), said.trim());
    }
    {
        const f = fakePage();
        const { e } = engineOn(f, { flowVoice: null });
        const { value, said } = await capture(() => e.attachVoiceToScene(2));
        ok('a story whose preset names no voice is left alone', value === false);
        ok('with nothing clicked', f.st.clicks.length === 0, JSON.stringify(f.st.clicks));
        ok('and the run says so up front', !/Attaching voice/.test(said));
    }
    {
        const f = fakePage();
        const { e } = engineOn(f);
        e.noVoice = true;
        const { value } = await capture(() => e.attachVoiceToScene(2));
        ok('--no-voice turns it off', value === false);
        ok('with nothing clicked', f.st.clicks.length === 0);
    }
    {
        const f = fakePage();
        const { e } = engineOn(f);
        e.skipRefs = true;
        const { value, said } = await capture(() => e.attachVoiceToScene(4));
        ok('--skip-refs is not silently ignored', value === false);
        ok('it says the prompt already carries it', /voice skipped for scene 4/.test(said), said.trim());
        ok('and clicks nothing', f.st.clicks.length === 0);
    }
    {
        const f = fakePage({ menuOpens: false });
        const { e } = engineOn(f);
        const { value, said } = await capture(() => e.attachVoiceToScene(5));
        ok('a clip whose voice did not attach says which clip', value === false);
        ok('and warns the voice may differ there',
           /could not be attached to scene 5 - this clip may read in another voice/.test(said), said.trim());
    }
    {
        // Flow accepts a voice ingredient on the initial Ingredients clip, but
        // rejects all ingredient chips inside an Extend request.
        const src = fs.readFileSync(path.join(__dirname, 'veo3_flow_new_ui.js'), 'utf8');
        ok('clip 1 attaches it', /await this\.attachVoiceToScene\(1\);/.test(src));
        ok('extend relies on prior clip continuity', !/await this\.attachVoiceToScene\(sceneNum\);/.test(src));
        ok('and the flag exists to turn it off', /--no-voice/.test(src));
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
