'use strict';

const fs = require('fs');
const path = require('path');

function safeStoryTitle(value, fallback = 'video') {
    let name = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
        .replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
    if (!name || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)) name = fallback;
    return name.slice(0, 180).replace(/[. ]+$/g, '') || 'video';
}

function titleFromStoryFile(file) {
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        return typeof data.title === 'string' && data.title.trim() ? data.title.trim() : '';
    } catch { return ''; }
}

function storyTitleBase(fileOrDirectory) {
    const resolved = path.resolve(fileOrDirectory);
    let directory = resolved;
    let preferred = null;
    try {
        if (fs.statSync(resolved).isFile()) {
            directory = path.dirname(resolved);
            preferred = resolved;
        }
    } catch { /* use the supplied path as a directory */ }

    const fallback = path.basename(directory) || 'video';
    if (preferred) return safeStoryTitle(titleFromStoryFile(preferred), fallback);

    const files = [];
    try {
        for (const name of fs.readdirSync(directory)) {
            if (/_story\.json$/i.test(name)) files.push(path.join(directory, name));
        }
    } catch { /* retain directory-name fallback */ }
    files.sort((a, b) => Number(path.basename(a).toLowerCase() !== `${fallback}_story.json`.toLowerCase()) -
        Number(path.basename(b).toLowerCase() !== `${fallback}_story.json`.toLowerCase()));
    for (const file of files) {
        const title = titleFromStoryFile(file);
        if (title) return safeStoryTitle(title, fallback);
    }
    return safeStoryTitle(fallback, 'video');
}

function fullVoiceoverMediaFolder(file) {
    const prepared = path.resolve(file);
    const folder = path.dirname(prepared);
    const parent = path.dirname(folder);
    if (path.basename(parent) !== 'full_voiceover' || path.basename(prepared) !== 'full_voiceover_story.json') return folder;
    try {
        const data = JSON.parse(fs.readFileSync(prepared, 'utf8').replace(/^\uFEFF/, ''));
        const original = path.resolve(data.original_story || '');
        const root = path.dirname(parent);
        if (data.full_voiceover_first === true && path.dirname(original) === root && fs.statSync(original).isFile()) return root;
    } catch {}
    return folder;
}
module.exports = { safeStoryTitle, storyTitleBase, fullVoiceoverMediaFolder };
