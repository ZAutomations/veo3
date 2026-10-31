const fs = require('fs');
const path = require('path');
function thumbnailPrompt(story, ratio = '16:9') {
    const concept = story.thumbnail || {};
    if (story.preset_id === 'reference-wolf-dark-secrets-fable-dialogue') {
        const headline = String(concept.headline || story.title || '').split(/[.!?]/)[0].split(/\s+/).slice(0, 5).join(' ').toUpperCase();
        const cast = Object.values(story.character_descriptions || {}).join('\n');
        const dialogue = (story.scenes || []).flatMap(s => (s.dialogue || []).map(t => `${t.speaker}: ${t.line}`)).join(' ').slice(0, 1000);
        return `Create ONE complete, independent ${ratio} YouTube thumbnail image for the original story "${story.title}". Compose natively for aspect ratio ${ratio}, matching the video clips.\n\nSTORY MOMENT: ${story.description || story.title}. Show a truthful, emotionally tense close conversation: the brown bear Companion looks hurt and uncertain while the wise Wolf listens with empathy. Frame both faces large in the foreground (about two-thirds of the image height), with clearly readable eyes and expressions at phone size. Keep their attention on each other. Use warm light on their faces against a simpler, darker background, with crisp separation and stronger light-dark contrast; avoid an evenly dim, muddy image. Keep the same calm setting and quiet counseling premise. Do not invent a betrayal reenactment, confrontation, third person, topic prop or event. Dialogue context: ${dialogue}\n\nRECURRING CHARACTER DESIGNS — reproduce exactly; do not merge identities or change clothing/colors:\n${cast}\n\nON-IMAGE HEADLINE — REQUIRED: write exactly “${headline}” in large, bold, clean, correctly spelled lettering. Use high-contrast warm ivory or pale gold type with a dark outline/shadow, placed in the upper safe area where it does not cover either face. Keep it readable on a phone. This is the only text in the image; no subtitle, extra words, labels, logo or watermark.\n\nART DIRECTION: vintage 2D illustrated storybook; dark atmospheric fable illustration; hand-painted matte watercolor textures; expressive dark ink outlines; mid-century European storybook mood; cinematic dramatic soft lighting; rich muted colors with enough contrast for a clear focal point; polished, professional mobile-readable composition. Keep surrounding details restrained so the characters and headline dominate.\n\nOne focal composition only. No collage, split screen, multiple panels, contact sheet, before/after or multiple scenes. No photorealism, 3D, plastic-looking characters, generic AI artwork or exaggerated cartoon expressions. No modern objects or environments unless the story requires them. Keep headline and faces within generous safe margins.\n`;
    }
    return `Create a compelling ${ratio} YouTube thumbnail for "${story.title}".
MAIN TOPIC: ${story.description || story.title}
VISUAL HOOK: ${concept.visual_concept || story.description || story.title}
STYLE: ${story.style || story.visual_style || story.niche || 'Match the video artwork'}
CHARACTERS: ${Object.keys(story.character_descriptions || {}).join(', ') || 'Use the actual subjects of the story'}. Use the supplied reference sheets; preserve their exact faces, hair, ages and clothing.
Use one clear focal idea, expressive faces when appropriate, strong readable contrast and a simple background. The topic must be understandable at phone size. Keep important faces and details inside safe margins.
Optional headline: "${headline}". Maximum five words, large readable lettering. Leave the text area clean if accurate lettering is unavailable.
Show the actual central tension or discovery of this video. Do not invent events, accusations, violence or misleading claims. No watermarks, logos, interface elements or multi-panel reference-sheet layouts.
`;
}
function writeThumbnailPrompts(folder, story) {
    const aspect = ['9:16','16:9','1:1'].includes(story.aspect_ratio) ? story.aspect_ratio
        : story.preset_id === 'reference-wolf-dark-secrets-fable-dialogue' ? '9:16' : '16:9';
    fs.writeFileSync(path.join(folder, 'thumbnail_prompt.txt'), thumbnailPrompt(story, aspect), 'utf8');
    fs.writeFileSync(path.join(folder, 'thumbnail_prompt_vertical.txt'), thumbnailPrompt(story, '9:16'), 'utf8');
}
module.exports = { thumbnailPrompt, writeThumbnailPrompts };
