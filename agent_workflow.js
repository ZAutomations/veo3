// Standalone GUI entry point. Reuses the generation pipeline without an MCP
// connection, protocol, story writer, or reference-video analysis.
const { TOOLS } = require('./mcp_server');
const { normalizeProjectUrl } = require('./flow_project');

function workflowArgs(argv) {
    const value = (flag, fallback = '') => {
        const i = argv.indexOf(flag);
        return i < 0 ? fallback : argv[i + 1];
    };
    const story = value('--story');
    if (!story) throw Error('Choose an existing story JSON.');
    const phase = value('--start-phase', 'start');
    if (!['start', 'clips'].includes(phase)) throw Error('Invalid start phase.');
    const submit = !argv.includes('--dry-run');
    const args = {
        stories: [story], start_phase: phase, generate: submit, submit,
        aspect: value('--aspect', 'Flow'), seconds: Number(value('--seconds', '8')),
        cdp: Number(value('--cdp', '9222')), watch: Number(value('--watch', '300')),
        video_model: value('--video-model', 'Flow'), veo_model: value('--model'),
        new_project: !argv.includes('--no-new-project'),
        generate_refs: !argv.includes('--no-generate-refs'),
        download: argv.includes('--download'), join: argv.includes('--join'),
        auto_approve: argv.includes('--auto-approve'), verbose: true,
        flow_characters: argv.includes('--flow-characters'),
    };
    if (value('--preset')) args.preset = value('--preset');
    if (phase === 'clips') {
        args.project_url = normalizeProjectUrl(value('--project-url'));
        args.new_project = false;
        args.generate_refs = false;
        args.no_upload_refs = true;
    }
    // Dry runs only rebuild the prompt, in either phase. No Flow work is run.
    if (!submit) args.start_phase = 'start';
    return args;
}

async function runWorkflow(argv) {
    const args = workflowArgs(argv);
    const pipeline = TOOLS.find(t => t.name === 'batch_pipeline');
    return pipeline.handler(args);
}

if (require.main === module) {
    runWorkflow(process.argv.slice(2)).then(result => {
        for (const item of result.content || []) if (item.text) console.log(item.text);
        if (result.isError) process.exitCode = 1;
    }).catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { workflowArgs, runWorkflow };
