'use strict';
const fs = require('fs');
const path = require('path');

const FLOW_ENDCARD_PRESETS = new Set([
    'reference-wolf-dark-secrets-fable-dialogue',
    'fern-documentary',
    '3d-zack-style',
]);

function isFlowEndcardPreset(story) {
    return FLOW_ENDCARD_PRESETS.has(String(story?.preset_id || ''));
}

function headlineFor(story) {
    const concept = story.thumbnail || {};
    const raw = String(concept.headline || story.title || '').split(/[.!?]/)[0];
    return raw.split(/\s+/).filter(Boolean).slice(0, 5).join(' ').toUpperCase();
}

function thumbnailPrompt(story, ratio = '9:16') {
    const concept = story.thumbnail || {};
    const headline = headlineFor(story);
    if (story.preset_id === 'reference-wolf-dark-secrets-fable-dialogue') {
        const cast = Object.values(story.character_descriptions || {}).join('\n');
        const dialogue = (story.scenes || []).flatMap(s => (s.dialogue || []).map(t => `${t.speaker}: ${t.line}`)).join(' ').slice(0, 1000);
        return `Create ONE complete, independent ${ratio} YouTube thumbnail image for the original story "${story.title}". Compose natively for aspect ratio ${ratio}, matching the video clips.\n\nSTORY MOMENT: ${story.description || story.title}. Show a truthful, emotionally tense close conversation: the brown bear Companion looks hurt and uncertain while the wise Wolf listens with empathy. Frame both faces large in the foreground (about two-thirds of the image height), with clearly readable eyes and expressions at phone size. Keep their attention on each other. Use warm light on their faces against a simpler, darker background, with crisp separation and stronger light-dark contrast; avoid an evenly dim, muddy image. Keep the same calm setting and quiet counseling premise. Do not invent a betrayal reenactment, confrontation, third person, topic prop or event. Dialogue context: ${dialogue}\n\nRECURRING CHARACTER DESIGNS — reproduce exactly; do not merge identities or change clothing/colors:\n${cast}\n\nON-IMAGE HEADLINE — REQUIRED: write exactly “${headline}” in large, bold, clean, correctly spelled lettering. Use high-contrast warm ivory or pale gold type with a dark outline/shadow, placed in the upper safe area where it does not cover either face. Keep it readable on a phone. This is the only text in the image; no subtitle, extra words, labels, logo or watermark.\n\nART DIRECTION: vintage 2D illustrated storybook; dark atmospheric fable illustration; hand-painted matte watercolor textures; expressive dark ink outlines; mid-century European storybook mood; cinematic dramatic soft lighting; rich muted colors with enough contrast for a clear focal point; polished, professional mobile-readable composition. Keep surrounding details restrained so the characters and headline dominate.\n\nOne focal composition only. No collage, split screen, multiple panels, contact sheet, before/after or multiple scenes. No photorealism, 3D, plastic-looking characters, generic AI artwork or exaggerated cartoon expressions. No modern objects or environments unless the story requires them. Keep headline and faces within generous safe margins.\n`;
    }

    const topic = String(story.description || story.title || '').trim();
    const hook = String(concept.visual_concept || topic).trim();
    const sharedLayout = `THUMBNAIL DESIGN — match this high-impact short-video reference layout without copying its subject or branding. One cinematic vertical composition in ${ratio}. Put a short, exact headline in the upper 35–45%: very large condensed uppercase lettering, stacked in two or three clean lines, with bold yellow, white and red words, a dark shadow/outline and rough black or red paint-stroke backing. Make every word spelled exactly as provided, easy to read on a phone, with safe margins. The lower area shows one large, unmistakable, topic-specific visual moment with a strong foreground subject and a darker contextual background. Use dramatic light, deep contrast, a focused red accent where appropriate, crisp subject separation and energetic but uncluttered framing. No logo, brand/trademark, watermark, UI, tiny text, extra labels, split panels, collage or contact sheet. The text must not cover the main subject.\n\nEXACT ON-IMAGE HEADLINE: “${headline}” — no additional wording.\nSTORY TOPIC: ${topic}\nVISUAL HOOK: ${hook}\n`;

    if (story.preset_id === 'fern-documentary') {
        const cast = Object.entries(story.character_descriptions || {}).map(([name, description]) => `${name}: ${description}`).join('\n');
        return `Create one finished YouTube thumbnail for the factual documentary "${story.title}". ${sharedLayout}\n\nFERN VISUAL IDENTITY: cinematic 3D documentary reconstruction with grounded materials, controlled dramatic lighting and the same subdued slate/teal palette with warm highlights as the video. All people must remain smooth, featureless matte mannequins with realistic adult proportions and role-appropriate clothing: no eyes, nose, mouth, hair or realistic skin. Use the supplied character reference images for consistent mannequin proportions and clothing when those people appear. Character references:\n${cast || 'Use the silent, featureless mannequin roles actually required by this story.'}\n\nDepict the exact central event, object, place or body process stated by the story. Select the most recognizable evidence or consequence as the focal image; do not add an unsupported culprit, victim, action, location or outcome. For a human-body topic, show the relevant body region or process in a clear non-graphic 3D reconstruction. Keep the source facts intact and avoid sensational gore. No unrelated generic laboratory, circuitry, gears, aircraft, police lights or technology unless the story actually concerns them.\n`;
    }

    if (story.preset_id === '3d-zack-style') {
        const cast = Object.entries(story.character_descriptions || {}).map(([name, description]) => `${name}: ${description}`).join('\n');
        return `Create one finished YouTube thumbnail for the original 3D science explainer "${story.title}". ${sharedLayout}\n\nZACK D VISUAL IDENTITY: high-end colorful 3D animated science-explainer art with polished dimensional forms, expressive but believable subjects, rich material detail, cinematic depth, and bright controlled highlights. Preserve the preset's 3D look while using the reference's bold headline scale and dramatic contrast. Recurring character/reference designs, if relevant:\n${cast || 'Use the actual person, animal, object or scientific subject named by the story; do not add an unrelated recurring character.'}\n\nShow the specific scientific subject and its real mechanism or consequence from this story, not generic technology imagery. For a body topic, make the correct organ or process large and immediately recognizable. For an object, show the actual object with one clear cutaway or cause-and-effect visual only when it explains the topic. Keep the image accurate to the story, visually simple and readable at phone size. No invented danger, false claim, brand logo or unrelated science props.\n`;
    }

    const characters = Object.keys(story.character_descriptions || {}).join(', ') || 'Use the actual subjects of the story';
    return `Create one compelling ${ratio} YouTube thumbnail for "${story.title}". ${sharedLayout}\nSTYLE: ${story.style || story.visual_style || story.niche || 'Match the video artwork'}\nCHARACTERS: ${characters}. Preserve supplied references. Show the actual central tension or discovery. Do not invent events, accusations, violence or misleading claims.\n`;
}

function writeThumbnailPrompts(folder, story) {
    const fallback = isFlowEndcardPreset(story) ? '9:16' : '16:9';
    const aspect = ['9:16', '16:9', '1:1'].includes(story.aspect_ratio) ? story.aspect_ratio : fallback;
    fs.writeFileSync(path.join(folder, 'thumbnail_prompt.txt'), thumbnailPrompt(story, aspect), 'utf8');
    fs.writeFileSync(path.join(folder, 'thumbnail_prompt_vertical.txt'), thumbnailPrompt(story, '9:16'), 'utf8');
}

function storyFileAndFolder(value) {
    if (!value) return null;
    const source = path.resolve(String(value));
    const folder = fs.existsSync(source) && fs.statSync(source).isDirectory() ? source : path.dirname(source);
    const direct = fs.existsSync(source) && fs.statSync(source).isFile() && /_story\.json$/i.test(source) ? source : '';
    const found = direct || (fs.existsSync(folder) ? fs.readdirSync(folder).find(name => /_story\.json$/i.test(name)) : '');
    return found ? { file: direct || path.join(folder, found), folder } : null;
}

function withFlowThumbnail(refs, storyPath) {
    const resolved = storyFileAndFolder(storyPath);
    if (!resolved) return refs;
    let story;
    try { story = JSON.parse(fs.readFileSync(resolved.file, 'utf8').replace(/^\uFEFF/, '')); }
    catch { return refs; }
    if (!isFlowEndcardPreset(story)) return refs;
    writeThumbnailPrompts(resolved.folder, story);
    if ((refs || []).some(ref => ref.kind === 'thumbnail' || String(ref.name).toLowerCase() === 'thumbnail')) return refs;
    const aspect = ['9:16', '16:9', '1:1'].includes(story.aspect_ratio) ? story.aspect_ratio : '9:16';
    return [...(refs || []), { name: 'Thumbnail', file: 'thumbnail_downloaded.png', kind: 'thumbnail',
        aspect, prompt: fs.readFileSync(path.join(resolved.folder, 'thumbnail_prompt.txt'), 'utf8').trim() }];
}

module.exports = { FLOW_ENDCARD_PRESETS, isFlowEndcardPreset, headlineFor, thumbnailPrompt, writeThumbnailPrompts, withFlowThumbnail };
