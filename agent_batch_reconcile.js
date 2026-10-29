const fs = require('fs');

// Extra ready tiles alone cannot identify scenes. Require matching saved scene
// instructions in the conversation, contiguous ranges, and a settled full grid.
function reconcileCompleted(snapshot, manifest, completed, sanitize = text => text) {
    const mt = snapshot.mediaTiles || {};
    const ready = mt.ready_video_tile;
    if (!snapshot.agentOn || mt.project_scan_complete === false || mt.agent_busy
        || mt.failed_video_tile || mt.generating_video_tile || ready <= completed
        || mt.flow_video_tile !== ready || ready > manifest.total) return null;
    const normalize = text => sanitize(String(text)).replace(/@[A-Za-z0-9_]+/g, '')
        .replace(/\s+/g, ' ').trim();
    const requests = (snapshot.conversationRows || []).filter(row => row.role === 'user' && !row.error);
    let through = completed;
    const verified = [];
    for (const batch of manifest.batches.filter(b => b.to > completed)) {
        if (batch.from !== through + 1 || batch.to > ready) return null;
        const text = fs.readFileSync(batch.prompt, 'utf8');
        const scenes = [...text.matchAll(/^Scene \d+ - [\s\S]*?(?=^Scene \d+ - |^Keep |$(?![\s\S]))/gm)]
            .map(match => normalize(match[0]));
        if (scenes.length !== batch.to - batch.from + 1) return null;
        const request = requests.find(row => {
            const content = normalize(row.text);
            return content.includes(`BATCH ONLY: Generate scenes ${batch.from}-${batch.to}`)
                && scenes.every(scene => content.includes(scene));
        });
        if (!request) return null;
        through = batch.to;
        verified.push({ from: batch.from, to: batch.to });
        if (through === ready) return { completed: through, verified };
    }
    return null;
}

// The Agent chat can be unmounted after reopening a project. Verify the actual
// video source prompts in an inspection tab instead of treating its empty chat
// as proof that the last batch was never submitted.
async function reconcileSources(engine, snapshot, manifest, completed, storyFile, options = {}) {
    const mt = snapshot.mediaTiles || {};
    const ready = mt.ready_video_tile;
    if (!snapshot.agentOn || mt.project_scan_complete !== true || mt.agent_busy
        || mt.failed_video_tile || mt.generating_video_tile || ready <= completed
        || mt.flow_video_tile !== ready || ready > manifest.total) return null;
    const source = fs.readFileSync(storyFile, 'utf8');
    const hash = require('crypto').createHash('sha256').update(source).digest('hex');
    if (hash !== manifest.context?.fingerprint) return null;
    const story = JSON.parse(source);
    if (story.scenes?.length !== manifest.total) return null;
    let through = completed;
    const verified = [];
    for (const batch of manifest.batches.filter(b => b.to > completed)) {
        if (batch.from !== through + 1 || batch.to > ready) return null;
        through = batch.to;
        verified.push({from:batch.from,to:batch.to});
        if (through === ready) break;
    }
    if (through !== ready) return null;
    const jobs = story.scenes.slice(completed, through).map((scene, i) => ({
        number:completed+i+1, scene, sceneId:require('./agent_scene_ids').sceneId(story,completed+i+1), prompt:scene.veo3_prompt || scene.script_line || ''
    }));
    const inspect = options.inspect || require('./single_clip_omni_recovery').inspectProject;
    const result = await inspect(engine, jobs, {}, {log:options.log});
    const ids = new Set();
    for (const job of jobs) {
        const tile = result.found[job.number];
        if (!tile?.ready || tile.failed || tile.busy || !tile.assetId
            || ids.has(tile.assetId) || !require('./single_clip_omni_media').promptMatches(tile, job)) return null;
        ids.add(tile.assetId);
    }
    return {completed:through, verified};
}

module.exports = { reconcileCompleted, reconcileSources };
