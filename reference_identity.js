const fs = require('fs');
const key = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const MARKER = 'REFERENCE IDENTITY AND WARDROBE:';

function withIdentity(prompt, refs, descriptions = {}, {agent = false} = {}) {
    if (!prompt || String(prompt).includes(MARKER)) return prompt;
    const characters = (refs || []).filter(r => r.name && !/place|location|room|set/i.test(r.kind || ''));
    if (!characters.length) return prompt;
    let text = String(prompt);
    for (const ref of characters.filter(r => r.presetReference && r.localFile)) {
        const name = Object.keys(descriptions).find(n => key(n) === key(ref.name));
        const prior = name && descriptions[name];
        if (typeof prior === 'string' && prior.length > 20) {
            text = text.split(prior).join(`${ref.name}: use the attached approved image for exact appearance and clothing.`);
        }
    }
    const names = [...new Set(characters.map(r => r.name))];
    const lock = `${MARKER} ${names.map(n => `${n} must match the image named ${n}`).join('; ')}. `
        + 'For each character when present, preserve the exact facial identity, face shape, skin tone, hairstyle, hair colour, clothing colour, fabric pattern, neckline, sleeves and accessories shown in that image throughout every shot. '
        + 'The approved image is the authority for appearance and wardrobe; it overrides conflicting generic cast descriptions or costumes. Keep the depicted outfit unchanged across this entire film, including close-ups and later scenes. Animate natural expressions and gestures without redesigning the face or changing the outfit. Do not invent an outfit, restyle hair, copy another character or recreate the reference-sheet layout.'
        + (agent ? ' In EVERY video-generation tool call, pass the actual named character image assets as visual reference/ingredient inputs for the characters in that scene. A name in text, a global chat attachment, an earlier clip or a newly generated substitute is insufficient. Reuse the same original image asset IDs throughout this batch and later batches. Preserve these asset inputs when retrying a scene. If a required image input cannot be passed, report the limitation before generating that scene.' : '');
    return lock + '\n' + text.replace(/^(Scene\s+\d+[^\n]*|CLIP\s+\d+[^\n]*)$/gim, heading => heading + '\n' + lock);
}

function forAgent(prompt, file, mentions) {
    if (!file || typeof file !== 'string' || !fs.existsSync(file)) return prompt;
    const library = require('./preset_reference_library');
    const story = library.readStory(file);
    const declared = require('./refs_for_scene').loadStoryRefs(file, story).refs;
    const refs = library.apply(declared, library.load('agent', undefined, story))
        .filter(r => (mentions || []).some(n => key(n) === key(r.name)));
    return withIdentity(prompt, refs, story.character_descriptions, {agent:true});
}

module.exports = {withIdentity, forAgent, MARKER};
