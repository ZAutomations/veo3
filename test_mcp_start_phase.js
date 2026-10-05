// Local subprocess fixtures: never connects to Flow or spends credits.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { normalizeProjectUrl, selectAgentPage } = require('./flow_project');

(async () => {
    const url = 'https://flow.google.com/project/test-id';
    assert.equal(normalizeProjectUrl(url + '/edit?x=1'), url);
    assert.equal(normalizeProjectUrl('https://labs.google/fx/en/tools/flow/project/test-id'), url);
    for (const invalid of ['', 'https://flow.google.com/', 'http://flow.google.com/project/id',
        'https://evil.test/project/id', 'https://user@flow.google.com/project/id']) {
        assert.throws(() => normalizeProjectUrl(invalid));
    }
    const blank = { url: () => 'about:blank' };
    let created = 0;
    const browser = { pages: async () => [blank], newPage: async () => { created++; return blank; } };
    assert.equal((await selectAgentPage(browser, url)).page, blank);
    assert.equal(created, 1);
    assert.equal((await selectAgentPage(browser, null)).page, null);
    const exact = { url: () => url };
    browser.pages = async () => [{ url: () => 'https://flow.google.com/project/other' }, exact];
    assert.equal((await selectAgentPage(browser, url)).page, exact);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-start-'));
    try {
        const story = path.join(tmp, 'example_story.json');
        const original = JSON.stringify({ title: 'Example', scenes: [] });
        fs.writeFileSync(story, original);
        fs.writeFileSync(path.join(tmp, 'agent_prompt.txt'), 'fixture');
        fs.writeFileSync(path.join(tmp, 'refs.json'), JSON.stringify({ refs: [{ name: 'Leo', prompt: 'Leo' }] }));
        fs.mkdirSync(path.join(tmp, 'clips'));
        fs.writeFileSync(path.join(tmp, 'clips', 'scene-01.mp4'), 'fixture');
        const calls = [];
        const spawn = (_exe, args) => {
            calls.push(args);
            const child = new EventEmitter();
            child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
            setImmediate(() => {
                if (path.basename(args[0]) === 'project_setup.js') child.stdout.emit('data', 'project_url : ' + url + '\n');
                child.emit('close', 0);
            });
            return child;
        };
        const sandbox = { module: { exports: {} }, __dirname,
            require: n => n === 'child_process' ? { spawn } : require(n),
            process: { ...process, stderr: { write() {} } }, console, setTimeout, clearTimeout, Buffer };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'mcp_server.js'), 'utf8'), sandbox);
        const batch = sandbox.module.exports.TOOLS.find(t => t.name === 'batch_pipeline');
        const base = { stories: [story], generate: true, submit: true, new_project: true,
            generate_refs: true, download: true, join: true, video_model: 'Veo 3.1 - Fast', aspect: '9:16', auto_approve: true };
        const result = await batch.handler({ ...base, start_phase: 'clips', project_url: url, from: 7, to: 9 });
        assert.ok(!result.isError, JSON.stringify(result));
        assert.deepEqual(calls.map(a => path.basename(a[0])), ['story_to_agent_prompt.js', 'agent_mode.js',
            'agent_download.js', 'order_clips_by_dialogue.js', 'join_clips.js']);
        const agent = calls[1];
        assert.ok(agent.includes('--no-upload-refs'));
        assert.equal(agent[agent.indexOf('--project-url') + 1], url);
        assert.equal(agent[agent.indexOf('--video-model') + 1], base.video_model);
        assert.equal(agent[agent.indexOf('--aspect') + 1], base.aspect);
        assert.equal(fs.readFileSync(story, 'utf8'), original);
        calls.length = 0;
        const full = await batch.handler(base);
        assert.ok(!full.isError, JSON.stringify(full));
        assert.deepEqual(calls.map(a => path.basename(a[0])).slice(0, 4),
            ['story_to_agent_prompt.js', 'project_setup.js', 'generate_refs.js', 'agent_mode.js']);
        assert.equal(calls[3][calls[3].indexOf('--aspect') + 1], base.aspect);
        calls.length = 0;
        for (const bad of [{ project_url: '' }, { stories: [story, story] }, { stories: [] },
            { references: ['https://example.com'] }, { generate: false }, { start_phase: 'wrong' }]) {
            const r = await batch.handler({ ...base, start_phase: 'clips', project_url: url, ...bad });
            assert.ok(r.isError, JSON.stringify(bad));
        }
        assert.equal(calls.length, 0);
    } finally {
        assert.equal(path.dirname(tmp), os.tmpdir());
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    console.log('MCP start-phase checks passed: routing, skips, validation, project tab recovery, full pipeline.');
})().catch(e => { console.error(e); process.exitCode = 1; });
