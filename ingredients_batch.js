const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function planBatch(input) {
    if (!Array.isArray(input.stories) || !input.stories.length) throw Error('Select one or more existing stories.');
    const stories = input.stories.map(value => {
        let file = path.resolve(__dirname, String(value));
        if (fs.statSync(file).isDirectory()) {
            const files = fs.readdirSync(file).filter(n => /_story\.json$/i.test(n));
            if (files.length !== 1) throw Error(`Select a specific story JSON in ${file}.`);
            file = path.join(file, files[0]);
        }
        const story = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(story.scenes) || !story.scenes.length) throw Error(`No scenes in ${file}.`);
        return file;
    });
    const from = Number(input.from || 1), to = Number(input.to || stories.length);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > stories.length) {
        throw Error('Invalid story range. From/To refer to positions in the story list.');
    }
    const o = input.options || {};
    return stories.slice(from - 1, to).map((story, index) => {
        const args = [path.join(__dirname, 'veo3_flow_new_ui.js'), story,
            '--from', '1', '--to', '0', '--new-project', '--gen-refs', '--refs-on-clip1',
            '--video-model', o.video_model || 'Flow', '--aspect', o.aspect || 'Flow',
            '--cdp', String(o.cdp || 9222)];
        if (o.account) args.push('--account', o.account);
        if (o.refs_only) args.push('--refs-only');
        else {
            args.push('--auto-start');
            if (o.join) args.push('--join');
            else if (o.download === false) args.push('--no-download');
        }
        return { index: from + index, story, args };
    });
}

function runChild(job, onProject) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, job.args, { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
        let pending = '';
        child.stdout.on('data', chunk => {
            process.stdout.write(chunk);
            pending += chunk.toString();
            const lines = pending.split(/\r?\n/); pending = lines.pop();
            for (const line of lines) {
                const match = line.match(/project_url:\s*(https:\/\/flow\.google\.com\/project\/[\w-]+)/);
                if (match) onProject(match[1]);
            }
        });
        child.stderr.on('data', chunk => process.stderr.write(chunk));
        child.on('error', reject);
        child.on('close', code => resolve(code === null ? 1 : code));
    });
}

async function runBatch(input, { run = runChild, save = () => {}, log = console.log } = {}) {
    const jobs = planBatch(input); // Validate all stories before spending anything.
    const state = { started: new Date().toISOString(), status: 'running', jobs: [] };
    for (const job of jobs) {
        const record = { index: job.index, story: job.story, status: 'running' };
        state.jobs.push(record); save(state);
        log(`\nIngredients batch: story ${job.index}/${input.stories.length} — ${path.basename(job.story)}`);
        let code;
        try { code = await run(job, url => { record.project_url = url; save(state); }); }
        catch (e) { code = 1; record.error = e.message; }
        record.exit_code = code;
        record.status = code === 0 ? 'complete' : 'failed';
        if (code !== 0) {
            state.status = 'stopped'; state.resume_from = job.index; save(state);
            log(`Batch stopped at story ${job.index} (exit ${code}). Completed stories were kept. Retry from this story after fixing the issue.`);
            return { code, state };
        }
        save(state);
    }
    state.status = 'complete'; save(state);
    log(`Ingredients batch complete: ${jobs.length} stories.`);
    return { code: 0, state };
}

if (require.main === module) {
    const file = process.argv[2];
    Promise.resolve().then(() => {
        if (!file) throw Error('Supply the batch request JSON.');
        const input = JSON.parse(fs.readFileSync(file, 'utf8'));
        const statusPath = file.replace(/\.json$/i, '') + '.status.json';
        console.log('Batch progress: ' + statusPath);
        return runBatch(input, { save: state => fs.writeFileSync(statusPath, JSON.stringify(state, null, 2)) });
    }).then(result => { process.exitCode = result.code; })
        .catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { planBatch, runBatch };
