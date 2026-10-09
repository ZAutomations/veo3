const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const atomicJson = (file, value) => {
    fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
    fs.renameSync(file + '.tmp', file);
};

// Build the complete local queue before any request is sent to Flow.
async function prepareAgentBatches(a, storyJson, state, run, log = () => {}) {
    const dir = path.dirname(storyJson);
    const folder = path.join(dir, `agent_batches_${state.project}`);
    fs.mkdirSync(folder, { recursive: true });
    const manifestFile = path.join(folder, 'batches.json');
    let old;
    try { old = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (_) {}
    const generator = digest(['story_to_agent_prompt.js', 'simple_dialogue_prompt.js',
        'dialogue_shot_plan.js', 'dialogue_speakers.js', 'location_style.js']
        .map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n'));
    const context = { fingerprint: state.fingerprint, aspect: state.aspect,
        flow_characters: !!a.flow_characters, generator };
    const cacheMatches = old && JSON.stringify(old.context) === JSON.stringify(context);
    const ranges = [];
    // Preserve an interrupted range even when the requested batch size changes.
    for (let from = 1; from <= state.completed; from += state.size) {
        ranges.push({ from, to: Math.min(state.completed, from + state.size - 1) });
    }
    if (state.pending) ranges.push({ ...state.pending });
    for (let from = state.pending ? state.pending.to + 1 : state.completed + 1;
        from <= state.total; from += state.size) {
        ranges.push({ from, to: Math.min(state.total, from + state.size - 1) });
    }
    const batches = [];
    log(`Preparing all ${ranges.length} numbered Agent batch files before generation...`);
    for (const [index, range] of ranges.entries()) {
        const { from, to } = range;
        const pending = state.pending && from === state.pending.from && to === state.pending.to;
        const prior = old && old.context && old.context.fingerprint === state.fingerprint
            && Array.isArray(old.batches) && old.batches.find(b => b.from === from && b.to === to);
        const intact = prior && fs.existsSync(prior.prompt)
            && digest(fs.readFileSync(prior.prompt)) === prior.sha256;
        const file = path.join(folder, `batch_${String(index + 1).padStart(3, '0')}_scenes_${String(from).padStart(3, '0')}_${String(to).padStart(3, '0')}.txt`);
        // A pending submission must retain exactly the text originally sent.
        const legacy = pending && (state.pending.prompt || path.join(dir, `agent_batch_${from}_${to}.txt`));
        if (pending && intact) {
            if (prior.prompt !== file) fs.copyFileSync(prior.prompt, file);
        } else if (legacy && fs.existsSync(legacy)) {
            fs.copyFileSync(legacy, file);
        } else if (cacheMatches && intact) {
            if (prior.prompt !== file) fs.copyFileSync(prior.prompt, file);
        } else {
            const temp = file + '.tmp';
            const build = await run('story_to_agent_prompt.js', [storyJson, '--scene-from', String(from),
                '--scene-to', String(to), '--aspect', state.aspect, '--out', temp,
                ...(a.flow_characters ? ['--flow-characters'] : [])], { timeoutMs: 120000 });
            if (build.code !== 0) throw new Error(`Cannot prepare batch ${from}-${to}: ${build.out || ''}${build.err || ''}`);
            if (!fs.existsSync(temp) || !fs.readFileSync(temp, 'utf8').trim()) {
                throw new Error(`Batch ${from}-${to} produced no prompt text.`);
            }
            fs.renameSync(temp, file);
        }
        batches.push({ number: index + 1, from, to, prompt: file,
            sha256: digest(fs.readFileSync(file)) });
    }
    atomicJson(manifestFile, { context, total: state.total, batch_size: state.size, batches });
    log(`All ${batches.length} batch files ready: ${folder}`);
    return batches;
}

// Persist intent BEFORE launching Flow. An interrupted/uncertain submission is
// retried through failed-media controls only, never by replaying its prompt.
async function runAgentBatches(a, storyJson, run, log) {
    const source = fs.readFileSync(storyJson, 'utf8');
    const story = JSON.parse(source);
    const total = (story.scenes || []).length;
    if (Number(story.total_scenes) > 0 && Number(story.total_scenes) !== total) return { ok: false, text: `Story declares ${story.total_scenes} clips but contains ${total} scenes. Stopped before generation/download/join; repair the incomplete story first.` };
    const aspect = String(a.aspect || story.aspect_ratio || 'Flow').trim();
    const project = String(a.project_url || '').match(/\/project\/([^/?#]+)/);
    if (!project) return { ok: false, text: 'Clip batching requires the Flow project URL. Supply project_url or enable Create new project.' };
    const fingerprint = crypto.createHash('sha256').update(source).digest('hex');
    const dir = path.dirname(storyJson);
    const stateFile = path.join(dir, `agent_batches_${project[1]}.json`);
    let state;
    if (fs.existsSync(stateFile)) {
        try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
        catch (e) { return { ok: false, text: 'Batch checkpoint is unreadable. Stopped to prevent duplicate submissions.' }; }
        if (state.fingerprint !== fingerprint || state.project !== project[1]) {
            return { ok: false, text: 'Story changed since this project began. Stopped to prevent mixing different scripts; use a new project.' };
        }
    } else {
        state = { project: project[1], project_url: a.project_url, fingerprint, total,
            size: Math.max(1, Math.min(7, Number(a.clip_batch_size) || 5)), completed: 0, pending: null, aspect };
    }
    // Keep an interrupted batch intact; subsequent batches use the new size.
    state.size = Math.max(1, Math.min(7, Number(a.clip_batch_size) || 5));
    const save = () => {
        fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state, null, 2));
        fs.renameSync(stateFile + '.tmp', stateFile);
    };
    const output = [];
    if (!total) return { ok: false, text: 'Story has no scenes.' };
    // Do not rebuild a finished project's queue or submit any prompts again.
    if (state.completed >= total) return { ok: true, storyJson, text: `All ${total} clips were previously completed in this project; nothing resubmitted.` };
    state.aspect = aspect;
    let batches;
    try { batches = await prepareAgentBatches(a, storyJson, state, run, log); }
    catch (e) { return { ok: false, storyJson, text: `Batch preparation failed before generation: ${e.message}` }; }
    while (state.completed < total) {
        const submissionFile = stateFile + '.submission.json';
        let previousSubmission;
        try { previousSubmission = JSON.parse(fs.readFileSync(submissionFile, 'utf8')); } catch (_) {}
        const pendingNeverSubmitted = state.pending && previousSubmission
            && previousSubmission.fingerprint === fingerprint
            && previousSubmission.from === state.pending.from && previousSubmission.to === state.pending.to
            && previousSubmission.status === 'preparing';
        const recovering = !!state.pending && !pendingNeverSubmitted;
        const from = state.pending ? state.pending.from : state.completed + 1;
        const to = state.pending ? state.pending.to : Math.min(total, state.completed + state.size);
        const batch = batches.find(b => b.from === from && b.to === to);
        if (!batch || !fs.existsSync(batch.prompt) || digest(fs.readFileSync(batch.prompt)) !== batch.sha256) {
            return { ok: false, storyJson, text: `Saved batch ${from}-${to} is missing or changed. Stopped before submitting it; rerun to prepare the queue again.` };
        }
        const prompt = batch.prompt;
        if (!recovering) {
            state.pending = { from, to, prompt };
            save();
        }
        log(`Agent clip batch ${from}-${to}/${total}: ${recovering ? 'checking/retrying failed tiles only' : 'submitting this batch only'}`);
        const prepareSubmission = () => {
            fs.writeFileSync(submissionFile + '.tmp', JSON.stringify({ fingerprint, from, to, status: 'preparing' }));
            fs.renameSync(submissionFile + '.tmp', submissionFile);
        };
        if (!recovering) prepareSubmission();
        const singleArgs = { ...a, _submission_file: submissionFile, _single_batch: true, _prompt_file: prompt,
            aspect,
            watch: Math.max(900, Number(a.watch) || 0),
            _expected: to, _required_ready: state.completed, _retry_only: recovering,
            no_upload_refs: a.no_upload_refs || state.completed > 0 };
        let result = await run(singleArgs);
        if (recovering && result.retrySubmission === true) {
            log(`Batch ${from}-${to}: Flow rejected the Agent request before creating media. Resending only this batch.`);
            prepareSubmission();
            result = await run({ ...singleArgs, _retry_only: false });
        }
        output.push(result.text);
        if (!result.ok) {
            output.push(`Batch ${from}-${to} paused. No later scenes submitted. Checkpoint: ${stateFile}\nResume using this SAME project URL and story. Conversation-level Try again repeats the batch; use failed-clip retry only. If no individual retry exists, automatic recovery stops safely.`);
            return { ok: false, storyJson, text: output.join('\n\n') };
        }
        const reconciled = Number(result.reconciledTo);
        state.completed = Number.isInteger(reconciled) && reconciled >= to && reconciled <= total ? reconciled : to;
        if (state.completed > to) log(`Checkpoint synchronized with verified Flow batches: scenes 1-${state.completed} complete. No prompts replayed.`);
        state.pending = null;
        save();
        if (state.completed < total) log(`Batch ${from}-${to} completed. Automatically sending scenes ${state.completed + 1}-${Math.min(total, state.completed + state.size)} next.`);
    }
    return { ok: true, storyJson, text: output.join('\n\n') || `All ${total} clips were previously completed in this project; nothing resubmitted.` };
}

module.exports = { runAgentBatches, prepareAgentBatches };
