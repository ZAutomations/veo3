'use strict';
const fs = require('fs');
const path = require('path');

const FLOW_ENDCARD_PRESETS = new Set([
    'reference-wolf-dark-secrets-fable-dialogue',
    'geography-map',
    'fern-documentary',
    '3d-zack-style',
    'intimacy-health-3d',
]);

function isFlowEndcardPreset(story) {
    return FLOW_ENDCARD_PRESETS.has(String(story?.preset_id || ''));
}

function headlineFor(story) {
    const concept = story.thumbnail || {};
    const title = String(story.title || '').trim();
    let raw = String(concept.headline || title).trim();
    // Recover old headlines that were merely the first five words of the title.
    if (title.toLowerCase().startsWith(raw.toLowerCase()) && raw.length < title.length) raw = title;
    return raw.replace(/\s+/g, ' ').toUpperCase();
}

function intimacyHeadlineLines(headline) {
    const words = String(headline || '').split(/\s+/).filter(Boolean);
    const lines = [];
    const base = Math.floor(words.length / 3);
    const remainder = words.length % 3;
    let cursor = 0;
    for (let i = 0; i < 3 && cursor < words.length; i++) {
        const count = base + (i < remainder ? 1 : 0);
        lines.push(words.slice(cursor, cursor + count).join(' '));
        cursor += count;
    }
    return lines;
}

function intimacySupportingQuestion(story) {
    const supplied = String(story.thumbnail?.supporting_question || story.thumbnail?.subtitle || '').trim();
    if (supplied) return supplied.replace(/\s+/g, ' ').toUpperCase();
    const title = String(story.title || '').toLowerCase();
    if (/^how\b/.test(title)) return 'HOW DOES IT WORK?';
    if (/^why\b/.test(title)) return 'WHY DOES IT HAPPEN?';
    if (/^what if\b/.test(title)) return 'WHAT WOULD HAPPEN?';
    return 'WHAT HAPPENS INSIDE?';
}

function thumbnailPrompt(story, ratio = '9:16') {
    const concept = story.thumbnail || {};
    const headline = headlineFor(story);
    if (story.preset_id === 'reference-wolf-dark-secrets-fable-dialogue') {
        const cast = Object.values(story.character_descriptions || {}).join('\n');
        const dialogue = (story.scenes || []).flatMap(s => (s.dialogue || []).map(t => `${t.speaker}: ${t.line}`)).join(' ').slice(0, 1000);
        return `Create ONE complete, independent ${ratio} YouTube thumbnail image for the original story "${story.title}". Compose natively for aspect ratio ${ratio}, matching the video clips.\n\nSTORY MOMENT: ${story.description || story.title}. Show a truthful, emotionally tense close conversation: the cinnamon-brown bear Companion looks hurt and uncertain while the wise slate-grey Wolf listens with empathy. Frame both faces large in the foreground (about two-thirds of the image height), with clearly readable eyes and expressions at phone size. Keep their attention on each other. Use warm light on their faces against a simpler, darker background, with crisp separation and stronger light-dark contrast; avoid an evenly dim, muddy image. Keep the same calm setting and quiet counseling premise. Do not invent a betrayal reenactment, confrontation, third person, topic prop or event. Dialogue context: ${dialogue}\n\nRECURRING CHARACTER DESIGNS — reproduce exactly; do not merge identities or change clothing/colors:\n${cast}\n\nON-IMAGE HEADLINE — REQUIRED: write exactly “${headline}” in large, bold, clean, correctly spelled lettering. Use high-contrast warm ivory or pale gold type with a dark outline/shadow, placed in the upper safe area where it does not cover either face. Keep it readable on a phone. This is the only text in the image; no subtitle, extra words, labels, logo or watermark.\n\nART DIRECTION: original hand-painted 2D gouache and colored-pencil illustration on visible paper grain; irregular expressive contours; deep-teal, warm-ochre and cream accents; soft cinematic lamplight; clear focal separation and a polished, mobile-readable composition. Keep surrounding details restrained so the characters and headline dominate.\n\nOne focal composition only. No collage, split screen, multiple panels, contact sheet, before/after or multiple scenes. No photorealism, 3D, plastic-looking characters or exaggerated cartoon expressions. Keep headline and faces within generous safe margins.\n`;
    }

    const topic = String(story.description || story.title || '').trim();
    const hook = String(concept.visual_concept || topic).trim();
    const sharedLayout = `THUMBNAIL DESIGN — match this high-impact short-video reference layout without copying its subject or branding. One cinematic vertical composition in ${ratio}. Put a short, exact headline in the upper 35–45%: very large condensed uppercase lettering, wrapped across as many clean lines as needed; reduce font size to preserve the complete headline, never omit or truncate words, with bold yellow, white and red words, a dark shadow/outline and rough black or red paint-stroke backing. Make every word spelled exactly as provided, easy to read on a phone, with safe margins. The lower area shows one large, unmistakable, topic-specific visual moment with a strong foreground subject and a darker contextual background. Use dramatic light, deep contrast, a focused red accent where appropriate, crisp subject separation and energetic but uncluttered framing. No logo, brand/trademark, watermark, UI, tiny text, extra labels, split panels, collage or contact sheet. The text must not cover the main subject.\n\nEXACT ON-IMAGE HEADLINE: “${headline}” — no additional wording.\nSTORY TOPIC: ${topic}\nVISUAL HOOK: ${hook}\n`;

    if (story.preset_id === 'fern-documentary') {
        const cast = Object.entries(story.character_descriptions || {}).map(([name, description]) => `${name}: ${description}`).join('\n');
        return `Create one finished YouTube thumbnail for the factual documentary "${story.title}". ${sharedLayout}\n\nFERN VISUAL IDENTITY: cinematic 3D documentary reconstruction with grounded materials, controlled dramatic lighting and the same subdued slate/teal palette with warm highlights as the video. All people must remain smooth, featureless matte mannequins with realistic adult proportions and role-appropriate clothing: no eyes, nose, mouth, hair or realistic skin. Use the supplied character reference images for consistent mannequin proportions and clothing when those people appear. Character references:\n${cast || 'Use the silent, featureless mannequin roles actually required by this story.'}\n\nDepict the exact central event, object, place or body process stated by the story. Select the most recognizable evidence or consequence as the focal image; do not add an unsupported culprit, victim, action, location or outcome. For a human-body topic, show the relevant body region or process in a clear non-graphic 3D reconstruction. Keep the source facts intact and avoid sensational gore. No unrelated generic laboratory, circuitry, gears, aircraft, police lights or technology unless the story actually concerns them.\n`;
    }

    if (story.preset_id === 'intimacy-health-3d') {
        const cast = Object.entries(story.character_descriptions || {}).map(([name, description]) => `${name}: ${description}`).join('\n');
        const lines = intimacyHeadlineLines(headline);
        const colors = ['solid clean white', 'vibrant electric yellow', 'shock neon pink/magenta'];
        const stacked = lines.map((line, index) => `Line ${index + 1}: “${line}” in ${colors[index]}`).join('\n');
        const subtitle = intimacySupportingQuestion(story);
        return `Create one finished YouTube thumbnail for the accurate adult sexual-health explainer “${story.title}”. Compose natively as one uninterrupted vertical 9:16 portrait at 1080×1920 or higher; never make a collage, grid, split screen or contact sheet.\n\nINTIMACY HEALTH 3D VISUAL STYLE: polished stylized 3D volumetric educational animation, cinematic lighting, deep cobalt-blue background and strong dark contrast. Use vibrant neon-pink and golden-orange accents for a topic-appropriate anatomical cutaway, transparent outer layers, neural pathways, organ structures or cellular detail only when the actual story calls for them. The central hero image MUST clearly depict the specific anatomical or physiological concept stated in this video's title and story. Keep anatomy scientifically plausible, clean, non-graphic and educational; adult context only, non-erotic framing, no sexual act, exposed genital detail or suggestive posing. Floating molecular/cellular nodes may support the explanation without obscuring the subject. Crisp depth, polished dimensional surfaces, controlled glow, soft contact shadows, vibrant but coherent grade. No photorealistic live action, flat 2D, anime, cel shading, toy-like anatomy, watermark, logo or interface elements.\n\nCOMPOSITION: one large, unmistakable, story-specific anatomical/physiological focal subject, lit from within where appropriate. Keep all typography and key anatomy within safe vertical margins. The image must communicate the exact topic at phone size, not generic science or technology. Do not invent a medical mechanism, outcome, danger or cure.\n\nTHREE-LINE MAIN TITLE: place the following exact text in the upper portion over distinct dark textured paint-brush-stroke banner backing. Use bold, heavy, clean uppercase sans-serif block letters with excellent spelling and mobile-size readability. Use one line per color; keep each line separate, correctly ordered, and do not add words:\n${stacked}\nUse a dark outline/shadow for contrast. Preserve every supplied word exactly.\n\nBOTTOM SUBTITLE: place this exact short uppercase question on a separate dark paint-brush-stroke banner near the bottom, with safe margins and no overlap with the central anatomy: “${subtitle}”. Spell it exactly; add no other text.\n\nRECURRING REFERENCE DESIGNS, only if relevant to this story:\n${cast || 'Use the actual adult subject or anatomy named by this story; do not add an unrelated character.'}\n\nOne cohesive cinematic composition, not multiple panels. Avoid clutter, unsupported labels, illegible tiny text, extra captions, claims not present in the story, medical misinformation and misleading anatomical proportions.\n`;
    }

    if (story.preset_id === 'geography-map') {
        return `Create one finished vertical 9:16 YouTube thumbnail for the geography documentary “${story.title}”. ${sharedLayout}\n\nGEOGRAPHY MAP VISUAL IDENTITY: Use accurate, recognizable satellite/cartographic terrain for the exact region and event in this story. Make the named location and the central geographic event unmistakable at phone size. Use a cinematic 2.5D relief map with layered terrain, crisp coastlines/borders, controlled atmospheric depth, and the preset's topic-appropriate palette. For a journey, show the source-supported route and a clear traveler/vehicle marker; for war, show only verified fronts and named military objects; for an animal/natural feature story, show that actual animal/feature as the hero rather than a generic map pin. Do not use a generic globe, unrelated route, invented border, battle, casualty, distance, flag or event. Keep the map as the main image and compose a single clear focal point with dramatic but truthful contrast. Any visible place name or number must be exact, short, correctly spelled, and source-supported. No dense labels, fake UI, logo, watermark or extra text beyond the exact headline above.\n`;
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
