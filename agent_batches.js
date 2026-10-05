const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
        const prompt = path.join(dir, `agent_batch_${from}_${to}.txt`);
        if (!recovering) {
            const build = await run('story_to_agent_prompt.js', [storyJson, '--scene-from', String(from),
                '--scene-to', String(to), '--aspect', aspect, '--out', prompt,
                ...(a.flow_characters ? ['--flow-characters'] : [])], { timeoutMs: 120000 });
            if (build.code !== 0) return { ok: false, text: build.out + build.err };
            state.pending = { from, to };
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
        state.completed = to;
        state.pending = null;
        save();
        if (state.completed < total) log(`Batch ${from}-${to} completed. Automatically sending scenes ${state.completed + 1}-${Math.min(total, state.completed + state.size)} next.`);
    }
    return { ok: true, storyJson, text: output.join('\n\n') || `All ${total} clips were previously completed in this project; nothing resubmitted.` };
}

module.exports = { runAgentBatches };
