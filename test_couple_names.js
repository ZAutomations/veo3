const assert = require('assert');
const W = require('./write_story');
const { renameStoryInputs } = require('./couple_names');
for (const id of ['relationship-dialogue', 'relationship-dialogue-ghibli']) {
    const p = W.loadPreset(id);
    assert.deepStrictEqual(p.fixed_couple_names, { female: 'Sarah', male: 'George' });
    const cast = W.normaliseCast(p, [
        { name: 'Jane', gender: 'female', description: 'Jane is an adult woman.', sheet_prompt: 'Jane portrait' },
        { name: 'John', gender: 'male', description: 'John is an adult man.', sheet_prompt: 'John portrait' },
    ]);
    assert.deepStrictEqual(cast.map(c => c.name), ['Sarah', 'George']);
    assert.strictEqual(cast[0].sheet_prompt, 'Sarah portrait');
    const input = renameStoryInputs(p, cast, { blocking: 'Jane sits beside John.' }, [{
        characters: ['Jane', 'John'], dialogue: [{ speaker: 'John', line: "Jane, I understand. John's coat stays here." }],
    }]);
    assert.strictEqual(input.meta.blocking, 'Sarah sits beside George.');
    assert.strictEqual(input.scenes[0].dialogue[0].speaker, 'George');
    assert.strictEqual(input.scenes[0].dialogue[0].line, "Sarah, I understand. George's coat stays here.");
    const cm = { clips: [{ source_dialogue: [{ speaker: 'Person A', gender: 'female', line: 'John, I feel alone.' }, { speaker: 'Person B', gender: 'male', line: 'Jane, I am listening.' }] }] };
    const restored = W.enforceSourceDialogueFidelity([{ dialogue: [] }], cast, cm, p).scenes[0];
    assert.strictEqual(restored.dialogue[0].line, 'George, I feel alone.');
    assert.strictEqual(restored.dialogue[1].line, 'Sarah, I am listening.');
    assert.strictEqual(restored.dialogue[0].speaker, 'Sarah');
    assert.strictEqual(restored.dialogue[1].speaker, 'George');
    const alreadyNamed = W.normaliseCast(p, [
        { name: 'George', gender: 'male', source_name: 'John' },
        { name: 'Sarah', gender: 'female', source_name: 'Jane' },
    ]);
    assert.strictEqual(renameStoryInputs(p, alreadyNamed, {}, [{ line: 'John, listen to Jane.' }]).scenes[0].line, 'George, listen to Sarah.');
}
assert.strictEqual(W.normaliseCast(W.loadPreset('ghibli'), [{ name: 'John' }])[0].name, 'John');
console.log('PASS: both relationship presets rename cast, dialogue, direct address, blocking and reference prompts; source restoration preserves fixed names.');
