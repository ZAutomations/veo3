const assert = require('assert');
const { workflowArgs, runWorkflow } = require('./agent_workflow');
const base = ['--story', 'example.json', '--aspect', '9:16', '--video-model', 'Veo 3.1 - Fast'];
const start = workflowArgs(base);
assert.deepEqual(start.stories, ['example.json']);
assert.ok(start.new_project && start.generate_refs && start.submit);
assert.equal(start.aspect, '9:16');
assert.equal(start.video_model, 'Veo 3.1 - Fast');
const clips = [...base, '--start-phase', 'clips', '--project-url', 'https://flow.google.com/project/example'];
const resumed = workflowArgs(clips);
assert.equal(resumed.start_phase, 'clips');
assert.ok(!resumed.new_project && !resumed.generate_refs && resumed.no_upload_refs);
const dry = workflowArgs([...clips, '--dry-run']);
assert.ok(!dry.generate && !dry.submit);
assert.equal(dry.start_phase, 'start');
assert.throws(() => workflowArgs(['--story', 'x', '--start-phase', 'clips']), /Flow project URL/);
assert.throws(() => workflowArgs([]), /existing story/);
// Verify standalone dispatch uses the same pipeline that the MCP regression
// suite exercises, and never starts a server/client connection.
const pipeline = require('./mcp_server').TOOLS.find(t => t.name === 'batch_pipeline');
const original = pipeline.handler;
pipeline.handler = async args => { assert.deepEqual(args, resumed); return { content: [], isError: false }; };
runWorkflow(clips).then(r => {
    assert.equal(r.isError, false);
    console.log('Agent workflow checks passed: phase routing, settings, dry run, validation, shared pipeline.');
}).catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { pipeline.handler = original; });
