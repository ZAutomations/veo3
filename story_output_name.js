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

module.exports = { safeStoryTitle, storyTitleBase };
