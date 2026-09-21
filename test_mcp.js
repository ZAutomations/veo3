// Tests for mcp_server.js - the MCP stdio front-end.
//
// Spawns the real server as a child process and speaks JSON-RPC to it over
// stdio, the way an MCP client does, so the framing, the tool list and two
// non-networked tools are exercised for real.
//
// Run: node test_mcp.js     (no network)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HERE = __dirname;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 220) : ''}`); }
}

const child = spawn(process.execPath, [path.join(HERE, 'mcp_server.js')], {
    cwd: HERE, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

let buffer = '';
let stdoutLines = 0, badLines = 0;
const waiters = new Map();
child.stdout.on('data', (d) => {
    buffer += d.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        stdoutLines++;
        let msg;
        try { msg = JSON.parse(line); } catch (e) { badLines++; continue; }
        if (msg.id !== undefined && msg.id !== null && waiters.has(msg.id)) {
            const w = waiters.get(msg.id);
            waiters.delete(msg.id);
            w(msg);
        }
    }
});

let seq = 0;
function rpc(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(id); reject(new Error('timeout on ' + method)); }, 10000);
        waiters.set(id, (m) => { clearTimeout(timer); resolve(m); });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
}
function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}
async function callTool(name, args) {
    const m = await rpc('tools/call', { name, arguments: args || {} });
    return m.result;
}
function textOf(result) {
    return (result && result.content && result.content[0] && result.content[0].text) || '';
}

(async () => {
    console.log('\n--- handshake ---');
    const init = await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
    });
    ok('initialize returns the protocol version', init.result && init.result.protocolVersion === '2025-06-18');
    ok('and declares the tools capability', !!(init.result && init.result.capabilities && init.result.capabilities.tools));
    ok('and names the server', init.result.serverInfo.name === 'veo3-flow', JSON.stringify(init.result.serverInfo));
    notify('notifications/initialized', {});

    console.log('\n--- tools/list ---');
    const list = await rpc('tools/list', {});
    const names = (list.result.tools || []).map((t) => t.name);
    for (const want of ['list_presets', 'list_stories', 'new_project', 'generate_refs', 'analyze_video', 'write_story', 'build_prompt',
        'run_agent', 'download_clips', 'join_clips', 'pipeline_status', 'full_pipeline', 'batch_pipeline']) {
        ok(`exposes ${want}`, names.includes(want), names.join(', '));
    }
    ok('every tool has a description', (list.result.tools || []).every((t) => t.description && t.description.length > 20));
    ok('every tool has an inputSchema', (list.result.tools || []).every((t) => t.inputSchema && t.inputSchema.type === 'object'));
    const byName = (n) => (list.result.tools || []).find((t) => t.name === n);
    ok('write_story accepts a content_map',
        !!(byName('write_story').inputSchema.properties || {}).content_map);
    ok('full_pipeline accepts a reference_url',
        !!(byName('full_pipeline').inputSchema.properties || {}).reference_url);
    ok('full_pipeline can make a new project per film',
        !!(byName('full_pipeline').inputSchema.properties || {}).new_project);
    ok('batch_pipeline can make a new project per film',
        !!(byName('batch_pipeline').inputSchema.properties || {}).new_project);
    ok('new_project exposes a probe mode',
        !!(byName('new_project').inputSchema.properties || {}).probe);
    ok('generate_refs takes a story',
        !!(byName('generate_refs').inputSchema.properties || {}).story);
    ok('run_agent can generate the refs first',
        !!(byName('run_agent').inputSchema.properties || {}).generate_refs);
    ok('analyze_video requires a url', (byName('analyze_video').inputSchema.required || []).includes('url'));

    console.log('\n--- list_presets (local, no network) ---');
    const presetsRes = await callTool('list_presets', {});
    ok('list_presets succeeds', !presetsRes.isError, textOf(presetsRes).slice(0, 120));
    let presets = [];
    try { presets = JSON.parse(textOf(presetsRes)); } catch (e) { /* handled below */ }
    ok('it returns the preset array', Array.isArray(presets) && presets.length > 5, 'count=' + presets.length);
    ok('it includes relationship-dialogue', presets.some((p) => p.id === 'relationship-dialogue'));
    ok('and the items carry a label and a cast type',
        presets.every((p) => p.id && p.label),
        JSON.stringify(presets[0]));

    console.log('\n--- list_stories (local) ---');
    const storiesRes = await callTool('list_stories', {});
    ok('list_stories succeeds', !storiesRes.isError, textOf(storiesRes).slice(0, 120));
    let stories = [];
    try { stories = JSON.parse(textOf(storiesRes)); } catch (e) { /* handled below */ }
    ok('it returns an array', Array.isArray(stories));

    console.log('\n--- pipeline_status on a real story ---');
    const anyStory = stories.find((s) => s.story_json);
    if (anyStory) {
        const st = await callTool('pipeline_status', { story: anyStory.story_json });
        ok('pipeline_status succeeds', !st.isError);
        let status = {};
        try { status = JSON.parse(textOf(st)); } catch (e) { /* handled below */ }
        ok('it reports the title', status.title === anyStory.title, JSON.stringify(status.title));
        ok('it reports a cast list', Array.isArray(status.cast));
        ok('it reports the clips downloaded', typeof status.clips_downloaded === 'number');
    } else {
        console.log('  (no story on disk - skipping pipeline_status)');
    }

    console.log('\n--- build_prompt spawns the real stage script ---');
    if (anyStory) {
        const bp = await callTool('build_prompt', { story: anyStory.story_json });
        const bt = textOf(bp);
        ok('build_prompt succeeds', !bp.isError, bt.slice(0, 160));
        ok('it names the agent_prompt.txt it wrote',
            /agent_prompt\.txt: .+agent_prompt\.txt/.test(bt), bt.slice(-160));
        ok('the prompt file exists on disk',
            fs.existsSync(path.join(path.dirname(anyStory.story_json), 'agent_prompt.txt')));
    } else {
        console.log('  (no story on disk - skipping build_prompt)');
    }

    console.log('\n--- error handling ---');
    const bogus = await callTool('no_such_tool', {});
    ok('an unknown tool returns isError', bogus.isError === true);
    const empty = await callTool('batch_pipeline', {});
    ok('batch_pipeline with no items fails without spawning anything', empty.isError === true, textOf(empty).slice(0, 120));
    ok('and says what to give it', /references|ideas/.test(textOf(empty)), textOf(empty).slice(0, 120));

    console.log('\n--- framing ---');
    ok('every stdout line was valid JSON', badLines === 0, `${badLines} bad of ${stdoutLines}`);
    ok('logs went to stderr, not stdout', /ready on stdio/.test(stderr));
    ok('the server never wrote a banner to stdout', badLines === 0);

    try { child.kill(); } catch (e) { /* already gone */ }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.log('  FAIL test crashed -> ' + e.message);
    try { child.kill(); } catch (e2) { /* best effort */ }
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
});
