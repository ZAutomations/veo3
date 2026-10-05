const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('./write_story');
const C = require('./saved_couple');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-saved-couple-'));
try {
    const settings = { agent_saved_couple: true, ing_saved_couple: false };
    for (const name of ['sarah', 'george']) {
        settings[`couple_${name}_file`] = path.join(dir, name + '.png');
        fs.writeFileSync(settings[`couple_${name}_file`], Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLp0AAAAASUVORK5CYII=', 'base64'));
    }
    const couple = C.loadSavedCouple('agent', settings);
    assert.strictEqual(C.loadSavedCouple('ingredients', settings), null);
    assert.strictEqual(C.loadSavedCouple('writer', settings)[0].name, 'Sarah');
    settings.ing_saved_couple = true;
    assert.deepStrictEqual(C.loadSavedCouple('ingredients', settings), couple);
    const refs = C.applySavedRefs([{ name: 'Kitchen', kind: 'place', prompt: 'The room.' }], couple);
    assert.strictEqual(refs.length, 3);
    assert(refs[0].localFile && refs[1].localFile, 'both saved uploads precede location generation');
    assert(!refs[2].localFile, 'place keeps normal generation');
    const engine = { opts: { skipRefs: true, genRefs: false, refsOnClip1: false }, skipRefs: true, genRefs: false, refsOnClip1: false };
    C.applyIngredientsReferenceMode(engine, couple);
    assert.strictEqual(engine.skipRefs, false);
    assert.strictEqual(engine.genRefs, true);
    assert.strictEqual(engine.refsOnClip1, true);
    const resume = { opts: { genRefs: true }, resumeExisting: true, genRefs: true };
    C.applyIngredientsReferenceMode(resume, couple);
    assert.strictEqual(resume.genRefs, false, 'resume never returns to reference generation');
    const disabled = { opts: {}, skipRefs: true, genRefs: false, refsOnClip1: false };
    C.applyIngredientsReferenceMode(disabled, null);
    assert.strictEqual(disabled.skipRefs, true, 'disabled mode preserves manual choices');
    assert.throws(() => C.applySavedRefs([{ name: 'Hana', kind: 'character' }], couple), /Sarah\/George/);
    const p = W.loadPreset('relationship-dialogue-ghibli');
    const cast = W.normaliseCast(p, couple);
    const story = W.buildStory(p, cast, { description: 'A conversation.', moral: 'Listen.' }, [{
        scene_title: 'Conversation', dialogue: [{ speaker: 'Sarah', line: 'Listen to me.' }],
        narrative_context: 'Sarah and George in their room.', characters: ['Sarah', 'George'],
    }]);
    const file = W.writePackage(dir, p, story, cast);
    fs.writeFileSync(path.join(path.dirname(file), 'character_sheets.txt'), '=== SARAH ===   (human)\nOld Sarah identity\n\n=== GEORGE ===   (human)\nOld George identity\n\n=== PLACE - KITCHEN ===\nKeep the room.\n');
    C.bindSavedStory(file, couple);
    const sheets = fs.readFileSync(path.join(path.dirname(file), 'character_sheets.txt'), 'utf8');
    for (const c of couple) {
        assert(sheets.includes(c.description), 'sheet identity matches saved story identity');
        assert(sheets.includes(c.localFile), 'sheet points to the approved reference');
    }
    const savedRefs = JSON.parse(fs.readFileSync(path.join(dir, 'refs.json'))).refs;
    assert(savedRefs.some(r => r.name === 'Sarah' && r.localFile));
    assert(savedRefs.some(r => r.name === 'George' && r.localFile));
    const bytes = fs.readFileSync(file, 'utf8');
    C.bindSavedStory(file, couple);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), bytes, 'repeat runs keep story fingerprint unchanged');
    fs.unlinkSync(settings.couple_sarah_file);
    assert.throws(() => C.loadSavedCouple('agent', settings), /Sarah reference image/);
    settings.agent_saved_couple = false;
    assert.strictEqual(C.loadSavedCouple('agent', settings), null, 'disabled mode ignores missing files');
    console.log('PASS: both modes share sheets, retain locations, validate missing files, use fixed identity and preserve retry fingerprints.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
