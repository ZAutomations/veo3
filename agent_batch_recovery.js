// A conversation error may happen before Flow schedules any video. A partial
// batch, an unknown outcome, or an unrelated conversation must never be replayed.
function failedBeforeMedia(snapshot, pendingPrompt) {
    const mt = snapshot.mediaTiles || {};
    if (!snapshot.agentOn || snapshot.promptText === null
        || mt.flow_video_tile !== 0 || mt.ready_video_tile !== 0
        || mt.failed_video_tile !== 0 || mt.generating_video_tile !== 0) return false;
    const rows = snapshot.conversationRows || [];
    const last = rows[rows.length - 1];
    const request = rows[rows.length - 2];
    if (!last || !request || last.role !== 'agent' || request.role !== 'user'
        || !last.error || !/something went wrong|please try again/i.test(last.text)) return false;
    const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
    const prompt = normalize(pendingPrompt);
    // Reference chips may precede the text. Match the entire text, not merely
    // a scene count that could belong to a different film or batch.
    return prompt.length > 100 && normalize(request.text).includes(prompt);
}

// A click or a cleared composer is not proof that Flow scheduled videos.
// Stop an idle, empty request instead of waiting the whole 30-minute budget.
function submissionWatchdog(baseline=0, {idleMs=120000, now=Date.now}={}) {
    let idleSince=null;
    return snapshot => {
        const mt=snapshot.mediaTiles||{};
        if(mt.agent_busy || mt.flow_video_tile>baseline || mt.generating_video_tile>0
            || mt.failed_video_tile>0 || mt.project_scan_complete===false) {
            idleSince=null; return null;
        }
        if(idleSince===null)idleSince=now();
        if(now()-idleSince<idleMs)return null;
        return `Flow has been idle for ${Math.round(idleMs/1000)} seconds after submission without scheduling a new video. Existing videos: ${mt.flow_video_tile||0}; reference images: ${mt.flow_image_tile||0}. Submission outcome is unverified; checkpoint preserved and no prompt repeated.`;
    };
}

module.exports = { failedBeforeMedia, submissionWatchdog };
