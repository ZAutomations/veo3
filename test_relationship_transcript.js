const assert = require('assert');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { resolveTranscriptPreset } = require('./relationship_transcript');
const detail = 'Why did you betray our marriage? >> I made a choice. >> Tell me the truth.';
assert.strictEqual(resolveTranscriptPreset('ghibli', 'Our marriage', detail), 'relationship-dialogue-ghibli');
assert.strictEqual(resolveTranscriptPreset('ghibli', 'A forest adventure', 'An explorer finds a bridge.'), 'ghibli');
assert.strictEqual(resolveTranscriptPreset('relationship-dialogue', 'Our marriage', detail), 'relationship-dialogue');
assert.strictEqual(resolveTranscriptPreset('ghibli', 'Marriage advice', 'Write a new story about a marriage.'), 'ghibli');
const labelledDetail = 'Female: Why did you betray our marriage? >> Male: I made a choice. >> Female: Tell me the truth.';
const output = execFileSync(process.execPath, ['write_story.js', '--title', 'Our marriage', '--preset', 'ghibli', '--detail', labelledDetail, '--dry-run'], { encoding: 'utf8' });
assert(output.includes('preset   : Relationship Dialogue Ghibli'));
assert(output.includes('woman = Sarah, man = George'));
assert(output.includes('PASTED TRANSCRIPT IS THE SOURCE OF TRUTH'));
assert(output.includes('Treat >> as turn separators'));
// Exercise the complete build -> validation handoff with actual transcript
// input. A prompt-only assertion would miss the bug: prompts accepted source
// lines but buildStory omitted the source flag and validation rejected them.
const checkValidation = `
const assert = require('assert');
const W = require('./write_story');
for (const id of ['relationship-dialogue', 'relationship-dialogue-ghibli']) {
    const p = W.loadPreset(id);
    const cast = W.normaliseCast(p, [
        { name: 'Sarah', gender: 'female', description: 'An adult woman.' },
        { name: 'George', gender: 'male', description: 'An adult man.' }
    ]);
    const scenes = [16, 15].map((words, i) => ({
        scene_title: 'Conversation', characters: ['Sarah', 'George'],
        narrative_context: 'Sarah and George listen to one another in their room.',
        dialogue: [{ speaker: i ? 'George' : 'Sarah', line: Array(words).fill('word').join(' ') }]
    }));
    const story = W.buildStory(p, cast, { description: 'A conversation.', moral: 'Listen respectfully.' }, scenes);
    assert(story.source_dialogue_fidelity);
    assert.deepStrictEqual(W.validate(story, cast, p), [], id);
    delete story.source_dialogue_fidelity;
    assert(W.validate(story, cast, p).some(x => /needs at least 18/.test(x)), 'original ideas still retain the density check');
}
`;
execFileSync(process.execPath, ['-e', checkValidation, 'validation-fixture', '--detail', 'Female: ' + Array(16).fill('word').join(' ') + ' >> Male: ' + Array(15).fill('word').join(' ')], { encoding: 'utf8' });
console.log('PASS: relationship transcript selects the dialogue preset and fixed names; unrelated Ghibli stories retain their preset. No API calls.');
