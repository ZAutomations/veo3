'use strict';

const fs = require('fs');
const path = require('path');

// Flow virtualizes its grid. An off-screen flow-video-tile often contains only
// an <img> preview; the <video> child is mounted only while the tile is near the
// viewport. The custom element name remains authoritative throughout.
function isVideoRecord(tile) {
    return !!tile && (tile.isVideoTile === true
        || String(tile.tag || '').toLowerCase() === 'flow-video-tile'
        || Number(tile.videoCount || 0) > 0);
}

function isFailedRecord(tile) {
    if (!tile) return false;
    if (tile.failed === true) return true;
    const words = `${tile.text || ''} ${tile.caption || ''}`;
    return /audio generation failed|failed to generate|generation failed|something went wrong|try a different prompt|you have not been charged/i.test(words)
        || (tile.buttons || []).some(b => /^retry$/i.test(String(b.aria || '').trim()));
}

// Read old bytes before the new pass starts overwriting scene-XX filenames.
// Matching by the stable tile index lets a retry move a previously downloaded
// clip to its correct full-grid position after the old buggy partial scan had
// compressed six visible clips into scene-01..scene-06.
function loadPriorClips(outDir) {
    const found = new Map();
    const manifestPath = path.join(outDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return found;
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch { return found; }
    for (const clip of (manifest.clips || [])) {
        if (!clip || clip.got === false || isFailedRecord(clip) || !Number.isInteger(Number(clip.tileIndex)) || !clip.file) continue;
        const file = path.join(outDir, clip.file);
        try {
            const bytes = fs.readFileSync(file);
            if (bytes.length > 10000) found.set(Number(clip.tileIndex), {
                bytes, caption: String(clip.caption || ''), oldFile: clip.file,
            });
        } catch { /* missing or unreadable old clip */ }
    }
    return found;
}

function priorForTile(prior, tile) {
    const old = prior.get(Number(tile.index));
    if (!old) return null;
    const was = String(old.caption || '').trim();
    const now = String(tile.caption || '').trim();
    return was && now && was !== now ? null : old;
}

function selectStoryClips(clips, story) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const selected = [];
    const used = new Set();
    const missing = [];
    for (const [i, scene] of (story.scenes || []).entries()) {
        const dialogue = (scene.dialogue || []).map(d => d.line || '').filter(Boolean);
        const needles = dialogue.length ? dialogue.map(norm) : [norm(scene.script_line)];
        const hits = clips.filter(c => c.got && !isFailedRecord(c) && !used.has(c.file)
            && needles.length && needles.every(n => n.length >= 20 && norm(c.prompt).includes(n)))
            .sort((a,b) => a.tileIndex - b.tileIndex);
        if (!hits.length) { missing.push(i + 1); continue; }
        used.add(hits[0].file);
        selected.push({...hits[0], order:i+1, matched_scene:i+1, match_from:'project_prompt'});
    }
    return { selected, missing, extras: clips.filter(c => !used.has(c.file)) };
}

// Select exactly one positively identified clip per scene. Never resolve an
// excess count by truncating filenames: completion order is not story order.
function resolveSceneManifest(manifest) {
    const expected = Number(manifest.expected);
    if (!Number.isInteger(expected) || expected < 1) return manifest;
    const all = new Map();
    for (const c of [...(manifest.alternateClips || []), ...(manifest.clips || [])]) {
        if (c && c.file) all.set(c.file, {...all.get(c.file), ...c});
    }
    const selected = [];
    for (let scene = 1; scene <= expected; scene++) {
        const hits = (manifest.clips || []).filter(c => c.got !== false && !isFailedRecord(c)
            && Number(c.matched_scene) === scene
            && (c.match_from === 'project_prompt' || Number(c.match_cover) > 0))
            .sort((a,b) => Number(b.match_cover || 0) - Number(a.match_cover || 0)
                || Number(a.tileIndex ?? Infinity) - Number(b.tileIndex ?? Infinity));
        if (!hits.length) return manifest;
        selected.push({...all.get(hits[0].file), order:scene});
    }
    const used = new Set(selected.map(c => c.file));
    if (used.size !== expected) return manifest;
    return {...manifest, complete:true, needsSceneOrdering:false, clips:selected,
        alternateClips:[...all.values()].filter(c => !used.has(c.file))};
}

// Downloading files and assigning them to story scenes are separate stages.
// Generic Flow captions cannot prove scene identity; the dialogue matcher is
// allowed to run after successful transfers instead of being blocked here.
function downloadCompletion(clips, expected, storyReady, failed) {
    const ready = new Set(clips.filter(c => c.got === true && c.file).map(c => c.file)).size;
    const downloadComplete = !failed && ready > 0 && (!expected || ready >= expected);
    return { ready, downloadComplete, needsSceneOrdering: downloadComplete && !storyReady };
}

module.exports = { isVideoRecord, isFailedRecord, loadPriorClips, priorForTile, selectStoryClips, resolveSceneManifest, downloadCompletion };
