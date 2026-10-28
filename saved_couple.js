const fs = require('fs');
const path = require('path');

function loadSavedCouple(mode, settings, story) {
    return require('./preset_reference_library').load(mode, settings, story);
}

function applySavedRefs(refs, library) {
    return require('./preset_reference_library').apply(refs, library);
}

function applyIngredientsReferenceMode(engine, couple) {
    engine.savedCouple = couple;
    if (!couple || engine.opts.exportOnly) return;
    if (engine.resumeExisting) {
        engine.genRefs = false;
        engine.opts.genRefs = false;
        return;
    }
    engine.skipRefs = false;
    engine.genRefs = true;
    engine.refsOnClip1 = true;
    Object.assign(engine.opts, { skipRefs: false, genRefs: true, refsOnClip1: true });
}

function bindSavedStory(storyFile, library) {
    // Apply references at preparation time; keep story content and checkpoints stable.
    return library;
}
module.exports = { loadSavedCouple, applySavedRefs, bindSavedStory, applyIngredientsReferenceMode };
