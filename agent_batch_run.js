#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { runAgentBatches } = require('./agent_batches');

function batchDriverArgs(original, batch) {
    const args = [];
    const replaced = new Set(['--file', '--expected', '--require-ready', '--project-url', '--watch']);
    for (let i = 0; i < original.length; i++) {
        if (replaced.has(original[i])) { i++; continue; }
        if (original[i] === '--retry-failed-only') continue;
        args.push(original[i]);
    }
    args.push('--file', batch._prompt_file, '--project-url', batch.project_url,
        '--expected', String(batch._expected), '--require-ready', String(batch._required_ready),
        '--watch', String(batch.watch));
    if (batch._retry_only) args.push('--retry-failed-only');
    if (batch.no_upload_refs && !args.includes('--no-upload-refs')) args.push('--no-upload-refs');
    return args;
}

function runNode(script, args) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [path.join(__dirname, script), ...args], { cwd: __dirname, windowsHide: true });
        let out = '', err = '';
        child.stdout.on('data', b => { out = (out + b).slice(-16000); process.stdout.write(b); });
        child.stderr.on('data', b => { err = (err + b).slice(-16000); process.stderr.write(b); });
        child.on('error', e => resolve({ code: 1, out, err: e.message }));
        child.on('close', code => resolve({ code, out, err }));
    });
}

async function main(argv) {
    const value = name => argv[argv.indexOf(name) + 1];
    const story = argv.includes('--refs') ? value('--refs') : '';
    if (!story || !fs.existsSync(story)) throw new Error('A valid --refs story JSON is required for clip batching.');
    const savedCouple = require('./saved_couple').loadSavedCouple('agent');
    require('./saved_couple').bindSavedStory(story, savedCouple);
    let project = argv.includes('--project-url') ? value('--project-url') : '';
    if (!project) {
        const browser = await require('puppeteer').connect({ browserURL: `http://127.0.0.1:${argv.includes('--cdp') ? value('--cdp') : '9222'}`, defaultViewport: null });
        try {
            const pages = (await browser.pages()).filter(p => /^https:\/\/flow\.google\.com\/project\//i.test(p.url()));
            if (pages.length !== 1) throw new Error('Enter the intended project URL when multiple Flow projects are open.');
            project = pages[0].url();
        } finally { await browser.disconnect(); }
    }
    if (savedCouple && !argv.includes('--no-upload-refs')) {
        const refs = await runNode('generate_refs.js', ['--story', path.dirname(path.resolve(story)),
            '--project-url', project, '--cdp', argv.includes('--cdp') ? value('--cdp') : '9222']);
        if (refs.code !== 0) throw Error('Saved reference upload failed. Clip generation stopped.');
        argv.push('--no-upload-refs');
    }
    const result = await runAgentBatches({ project_url: project, submit: true,
        aspect: argv.includes('--aspect') ? value('--aspect') : undefined,
        no_upload_refs: argv.includes('--no-upload-refs'),
        watch: argv.includes('--watch') ? Number(value('--watch')) : 900 }, story,
    async (scriptOrBatch, args) => {
        if (typeof scriptOrBatch === 'string') return runNode(scriptOrBatch, args);
        const r = await runNode('agent_mode.js', batchDriverArgs(argv, scriptOrBatch));
        return { ok: r.code === 0, text: r.code === 0 ? 'Batch completed successfully.' : r.out + r.err };
    }, console.log);
    console.log(result.text);
    if (!result.ok) process.exitCode = 2;
}
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { batchDriverArgs };
