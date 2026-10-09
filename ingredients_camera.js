// Runtime instructions for the Ingredients engine only. Shared story/preset
// files remain untouched so the Agent route retains its own camera direction.
function ingredientsCameraPrompt(story, scene, prompt) {
    if (story?.single_speaker_advice || story?.niche === 'Fantasy Princess — Relationship Advice') return String(prompt || '');
    const turns = scene?.dialogue || [];
    if (!turns.length) return String(prompt || '');
    const speakers = [...new Set(turns.map(d => String(d.speaker || '').trim()).filter(Boolean))];
    const cast = Object.keys(story?.character_descriptions || {}).map(name => name[0].toUpperCase() + name.slice(1));
    const faces = [...new Set([...speakers, ...cast])].slice(0, 2);
    if (faces.length < 2) return String(prompt || '');
    const parts = String(prompt || '').split(/\n\[AUDIO\]/);
    let visual = parts.shift().replace(/\n\[INGREDIENTS CAMERA\][\s\S]*$/, '');
    // Remove camera-only sentences that conflict with the runtime shot plan;
    // never search/replace spoken lines in the AUDIO section.
    visual = visual.replace(/(?:The camera|Camera|Static locked-off camera)[^.!?\n]*(?:static|locked[- ]off|wide two[- ]shot|no movement|no camera movement)[^.!?\n]*[.!?]?/gi, '');
    const camera = '\n[INGREDIENTS CAMERA] This camera plan overrides static or locked-off framing instructions. '
        + 'Keep both characters seated in their established positions; move the camera, not the characters. '
        + 'Start from the established two-person framing. Within this clip, make a gentle cinematic push-in and lateral reframe '
        + `to a clear medium close-up of ${faces[0]}'s face, then smoothly reframe to a clear medium close-up of ${faces[1]}'s face. `
        + `Speaking turn order: ${turns.map(d => d.speaker).join(' -> ')}. Time each face focus to that character's own spoken line; `
        + 'only the labelled speaker talks and moves their lips. If one person has no line, show their silent listening reaction without inventing dialogue. '
        + 'Both faces must receive at least one clear focus in this clip. Keep focus on the current speaker during their turn, '
        + 'with smooth rack focus and restrained camera motion. In the final half-second, ease back to the same two-person framing '
        + 'and camera position used at the start so the next Extend begins from a stable shared view. '
        + 'Preserve the 180-degree axis, screen sides, faces, clothing, room and lighting. No orbit, shaky camera or location change. '
        + 'Fit these moves around the existing dialogue without cutting, adding or delaying spoken words.';
    return visual.trimEnd() + camera + (parts.length ? '\n[AUDIO]' + parts.join('\n[AUDIO]') : '');
}
module.exports = { ingredientsCameraPrompt };
