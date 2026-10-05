const assert = require('assert');
const { prepareReferences } = require('./ingredients_setup');
const { Veo3FlowNewUI, parseArgs } = require('./veo3_flow_new_ui');

function fixture(opts = {}) {
    const events = [];
    const page = { url: () => 'https://flow.google.com/project/example/tool/editor',
        goto: async url => { events.push(['goto', url]); } };
    return { events, page, browser: {}, opts, projectUrl: '', freshProject: false,
        genRefs: true, storyRefs: [{ name: 'Leo' }, { name: 'Studio' }],
        waitForFlowShell: async () => { events.push(['ready']); } };
}

(async () => {
    const e = fixture();
    await prepareReferences(e, { generateRefs: async (page, refs, opts) => {
        assert.deepEqual(e.events, [['goto', 'https://flow.google.com/project/example'], ['ready']]);
        assert.equal(opts.keepAgentOn, true); // shared routine leaves Agent OFF
        assert.equal(refs.length, 2);
        return { made: 2, failed: 0 };
    } });
    assert.ok(e._refsGenerated);
    assert.equal(e.projectUrl, 'https://flow.google.com/project/example');
    const fresh = fixture({ newProject: true });
    await prepareReferences(fresh, {
        createProject: async () => ({ page: fresh.page, url: 'https://flow.google.com/project/new-project' }),
        generateRefs: async () => ({ made: 2, failed: 0 }),
    });
    assert.equal(fresh.events[0][1], 'https://flow.google.com/project/new-project');
    for (const result of [{ made: 1, failed: 1 }, { made: 0, blocked: true }]) {
        const failed = fixture();
        await assert.rejects(prepareReferences(failed, { generateRefs: async () => result }), /Clip generation stopped/);
        assert.ok(!failed._refsGenerated);
    }
    const args = parseArgs(['node', 'engine', 'story.json', '--refs-only', '--new-project',
        '--video-model', 'Veo 3.1 - Fast', '--aspect', '9:16', '--no-download', '--join']);
    assert.ok(args.refsOnly && args.genRefs && args.newProject && args.join && args.download);
    assert.equal(args.aspect, '9:16');
    assert.equal(args.videoModel, 'Veo 3.1 - Fast');
    assert.ok(Veo3FlowNewUI.prototype.isEditorUrl('https://flow.google.com/project/example/tool/id'));
    // Defence below the GUI: From 2+ cannot accidentally turn --new-project
    // or --gen-refs into a fresh film. --fresh-project is still reserved for
    // an account rotation, which genuinely cannot use the old account's URL.
    const resumeOpts = parseArgs(['node', 'engine', 'story.json', '--from', '2',
        '--new-project', '--gen-refs']);
    // Exercise the constructor through Reflect so this stays a real option
    // normalization test while avoiding any browser work.
    const realResume = Reflect.construct(Veo3FlowNewUI, ['story.json', resumeOpts]);
    assert.ok(realResume.resumeExisting);
    assert.ok(!realResume.freshProject && !realResume.genRefs && !realResume.opts.newProject);
    const rotated = Reflect.construct(Veo3FlowNewUI, ['story.json', {
        fromScene: 5, freshProject: true, newProject: true, genRefs: true,
    }]);
    assert.ok(rotated.freshProject && rotated.genRefs && !rotated.resumeExisting);

    let selected = false;
    const resumeFixture = {
        resumeIgnoredNewProject: false, resumeIgnoredGenRefs: false,
        projectUrl: '', fromScene: 2,
        page: { url: () => 'https://flow.google.com/project/example/tool/editor' },
        browser: { pages: async () => [] },
        isEditorUrl: Veo3FlowNewUI.prototype.isEditorUrl,
        ensureEditor: async () => {}, countClips: async () => 1, countEmptySlots: async () => 0,
        countCompletedClips: async () => 1,
        clickNewestClip: async () => { selected = true; return true; },
    };
    await Veo3FlowNewUI.prototype.prepareExistingTimelineResume.call(resumeFixture);
    assert.ok(selected && resumeFixture.projectUrl === 'https://flow.google.com/project/example');
    let selectedCompleted = false;
    await Veo3FlowNewUI.prototype.prepareExistingTimelineResume.call({
        ...resumeFixture,
        projectUrl: '',
        countClips: async () => 2,
        countEmptySlots: async () => 1,
        countCompletedClips: async () => 1,
        clickNewestCompletedClip: async () => { selectedCompleted = true; return true; },
    });
    assert.ok(selectedCompleted, 'resume should reuse a pending Extend slot after the last completed clip');
    await assert.rejects(
        Veo3FlowNewUI.prototype.prepareExistingTimelineResume.call({
            ...resumeFixture, projectUrl: '', countClips: async () => 0, countEmptySlots: async () => 0,
            countCompletedClips: async () => 0,
        }), /expected exactly 1/);
    // Drive actual run() with only the reference phase mocked: no scenes/export.
    const setup = require('./ingredients_setup');
    const original = setup.prepareReferences;
    let prepared = false, disconnected = false;
    setup.prepareReferences = async () => { prepared = true; };
    try {
        await Veo3FlowNewUI.prototype.run.call({ opts: { refsOnly: true }, genRefs: true,
            loadScenes: async () => {}, initializeFailedPromptsLog: async () => {}, connect: async () => {},
            browser: { disconnect: async () => { disconnected = true; } },
            processSceneWithRetry: () => { throw Error('Must not generate clips'); },
            exportAndFinish: () => { throw Error('Must not export'); },
        });
        assert.ok(prepared && disconnected);
    } finally { setup.prepareReferences = original; }
    console.log('Ingredients checks passed: editor-to-home, fresh project, reference completion gate, CLI settings, phase-one-only.');
})().catch(e => { console.error(e); process.exitCode = 1; });
