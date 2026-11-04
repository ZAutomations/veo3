'use strict';

// Shared narration tempo calibrated from the creator-approved 8-second
// reference: approximately 24–26 spoken words in a full clip.
const TARGET_MIN_PER_SECOND = 3.0;
const TARGET_MAX_PER_SECOND = 3.25;
const HARD_MAX_PER_SECOND = 3.4;

function targets(seconds) {
    const duration = Number(seconds) || 8;
    return {
        min: Math.ceil(duration * TARGET_MIN_PER_SECOND),
        max: Math.floor(duration * TARGET_MAX_PER_SECOND),
        hard: Math.floor(duration * HARD_MAX_PER_SECOND),
    };
}

function lock(seconds) {
    const duration = Number(seconds) || 8;
    const { min, max, hard } = targets(duration);
    return `SHARED NARRATION PACE LOCK: This clip is ${duration} seconds. Speak at a brisk, clear documentary pace of about 3.0–3.25 words per second, matching the creator-approved reference. Target ${min}–${max} spoken words; absolute ceiling ${hard}. Do not confuse a calm or emotional tone with slow delivery. No long pauses, slow-motion speech, drawn-out syllables, repeated phrasing or silent lead-in. Read the supplied narration verbatim and finish naturally before the final 0.3 seconds; do not truncate, paraphrase or add words. Keep music and effects below the narration. Sync the visual beats to the spoken phrases: use the supplied timed shots, change focus when each phrase changes, keep a concrete relevant action visible during speech, and avoid long static holds. Preserve this preset's camera language—do not force camera movement where it is not part of the preset.`;
}

function applies(story, scene) {
    if (!scene || !String(scene.script_line || '').trim()) return false;
    if (story?.narrated === false || story?.narration_scope === 'none' || story?.narration_scope === 'dialogue') return false;
    return !Array.isArray(scene.dialogue) || scene.dialogue.length === 0;
}

function countWords(text) {
    return (String(text || '').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).length;
}

module.exports = { TARGET_MIN_PER_SECOND, TARGET_MAX_PER_SECOND, HARD_MAX_PER_SECOND, targets, lock, applies, countWords };
