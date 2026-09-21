// Tests for `narration_scope: "dialogue"` - a preset where the cast speak on
// screen to each other and there is no narrator anywhere. It is the inverse of
// every other preset, whose rule set is built on an off-screen voice describing
// the visuals, so the write path and the convert path both have to say so.
// Run: node test_dialogue_mode.js     (no network)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const W = require('./write_story.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
}

const talk = W.loadPreset('relationship-dialogue');
const ghibli = W.loadPreset('ghibli');
const animal = W.loadPreset('animal-kindness');

console.log('\n--- the preset is well formed ---');
ok('exists', !!talk);
ok('narration_scope is dialogue', talk.narration_scope === 'dialogue', talk.narration_scope);
ok('rather than a second relationship preset id', talk.id !== 'relationship');
ok('carries the semi-realistic medium anchor',
   /2\.5D semi-realistic/i.test(talk.style) && /8K/i.test(talk.style), talk.style);
ok('keeps the 8K and lens language', /8K resolution/i.test(talk.style) && /35mm lens/i.test(talk.style));
ok('the style anchor does not name a real studio',
   !/studio|pixar|disney|ghibli|netflix|marvel/i.test(talk.style), talk.style);
ok('the cast idiom inverts the usual guard - NOT live-action',
   /NOT live-action/.test(talk.cast_idiom) && /NOT a photograph/.test(talk.cast_idiom));
// The medium moved from manhwa to 2.5D semi-realism, which is a narrower target
// than "not live-action": the failure mode is no longer a photograph, it is a
// flat cel-shaded cartoon, so the guard has to name that instead.
ok('the cast idiom asks for the semi-realistic medium',
   /2\.5D semi-realistic/i.test(talk.cast_idiom), talk.cast_idiom);
ok('and rules the flat cartoon out by name',
   /NOT a flat cel-shaded cartoon/.test(talk.cast_idiom) && /NOT chibi/.test(talk.cast_idiom));
ok('and still rules out the photograph',
   /NOT a photograph/.test(talk.cast_idiom) && /NOT 3D CGI/.test(talk.cast_idiom));
ok('forbids a narrator', /no narrator/i.test(talk.avoid));
ok('forbids on-screen text', /no on-screen text/i.test(talk.avoid));
ok('forbids subtitles and watermarks',
   /subtitles/i.test(talk.avoid) && /watermarks/i.test(talk.avoid));
ok('forbids glitch and blur', /no glitch/i.test(talk.avoid) && /no motion blur/i.test(talk.avoid));
ok('describes the exchange shape in direction',
   /hook/i.test(talk.direction) && /aphorism/i.test(talk.direction) && /resolution/i.test(talk.direction));
ok('says outright that nobody narrates', /no narrator/i.test(talk.direction));
// This genre used to name four possible rooms here, which each batch read as a
// menu and picked from - so the film changed cafe every clip. The place is now
// chosen once per story by call 1, so the preset hardcodes no room at all.
ok('keeps the pair in one room instead of offering a menu of them',
   /SAME room/i.test(talk.direction) && !/a cafe, a tearoom/i.test(talk.direction));
ok('and hardcodes no place for the film', !talk.setting && !talk.setting_name);
ok('offers the hook-rules-doubt-aphorism shape',
   (talk.story_shapes || []).some(s => /provocative/i.test(s) && /aphorism/i.test(s)));
ok('is a human-only typed cast',
   talk.cast === 'required' && JSON.stringify(talk.cast_types) === '["human"]',
   JSON.stringify(talk.cast_types));
ok('declares no narrator voice', !talk.narration_voice);
ok('declares no sound bed', !talk.sound_style);

console.log('\n--- the look block replaces the narrator ---');
const talkLook = W.lookBlock(talk);
const ghibliLook = W.lookBlock(ghibli);
ok('has a SPEAKING line', /^SPEAKING: /m.test(talkLook));
ok('says there is no narrator', /There is no narrator, no voice-over/.test(talkLook));
ok('has no NARRATOR line at all', !/^NARRATOR: /m.test(talkLook));
ok('never prints an undefined voice', !/undefined/.test(talkLook), talkLook.match(/undefined.{0,40}/)?.[0]);
ok('ghibli keeps its NARRATOR line', /^NARRATOR: /m.test(ghibliLook));
ok('ghibli has no SPEAKING line', !/^SPEAKING: /m.test(ghibliLook));
ok('ghibli never prints undefined either', !/undefined/.test(ghibliLook));

console.log('\n--- scenesPrompt, dialogue branch ---');
const outline = Array.from({ length: 4 }, (_, i) => ({ title: 'T' + i, beat: 'B' + i }));
const cast = [
    { name: 'Vera', type: 'human', description: 'Same Vera throughout - a woman in her seventies.' },
    { name: 'Nadia', type: 'human', description: 'Same Nadia throughout - a woman in her twenties.' },
];
const talkPrompt = W.scenesPrompt(talk, cast, outline, 0, 4, []);
ok('explains how the film speaks', /HOW THIS FILM SPEAKS/.test(talkPrompt));
ok('says there is no narrator or voice-over', /There is NO narrator and NO voice-over/.test(talkPrompt));
ok('forbids narration in the lines', /do not write a line of narration/i.test(talkPrompt));
ok('forbids describing the scene out loud', /nobody says what the camera can already see/.test(talkPrompt));
ok('asks for dialogue as a field', /"dialogue"\s+- the lines spoken in THIS clip/.test(talkPrompt));
ok('shows the shape of a line', /\{"speaker": "<a cast name/.test(talkPrompt));
ok('asks for two to four turns', /Two to four turns per clip/.test(talkPrompt));
ok('requires at least one line', /at least one - this film is\s+a conversation/.test(talkPrompt));
ok('gives a word budget derived from the clip length',
   /total is 24 words\s+or fewer, hard limit 30/.test(talkPrompt));
// The prompt is hard-wrapped for reading, so allow the wrap.
ok('tells it to write speech, not prose', /Punctuate for speech, not\s+for prose/.test(talkPrompt));
ok('the skeleton carries a dialogue array',
   /"scenes":\[\{"scene_title":"","dialogue":\[\{"speaker":"","line":""\}\],"narrative_context"/.test(talkPrompt));
ok('the skeleton has no script_line', !/"script_line"/.test(talkPrompt));
ok('a later batch continues from the last exchange', (() => {
    const p2 = W.scenesPrompt(talk, cast, outline, 2, 4, [
        { script_line: '', dialogue: [{ speaker: 'Vera', line: 'Sit down, child.' }] },
    ]);
    return /THE PREVIOUS CLIP ENDED WITH THIS EXCHANGE[\s\S]*Vera: Sit down, child\./.test(p2);
})());
ok('and says conversation rather than "ended like this"',
   /carry the conversation on from it/.test(W.scenesPrompt(talk, cast, outline, 2, 4,
       [{ dialogue: [{ speaker: 'Vera', line: 'x' }] }])));

ok('ghibli never hears about dialogue', !/"dialogue"/.test(W.scenesPrompt(ghibli, cast, outline, 0, 4, [])));
ok('ghibli keeps its script_line field',
   /"script_line"\s+- the NARRATION, spoken by the narrator/.test(W.scenesPrompt(ghibli, cast, outline, 0, 4, [])));
ok('the animal preset never hears about dialogue',
   !/HOW THIS FILM SPEAKS/.test(W.scenesPrompt(animal, [], outline, 0, 4, [])));

console.log('\n--- the outline step plans a conversation ---');
const talkCast = W.castPrompt(talk);
ok('tells call 1 the film is a conversation', /This film is a CONVERSATION, not a montage/.test(talkCast));
ok('rules out beats that are only a picture', /A beat that is only a picture has nothing for anyone to say/.test(talkCast));
ok('names the turns to build', /the hook that stops the viewer, a rule, the doubt/.test(talkCast));
ok('the human identity profile is used',
   /human\s+- age, build, hair, face and skin tone/.test(talkCast));
ok('it still asks for a type per character', /"type"\s+- one of: human/.test(talkCast));
ok('ghibli is never told it is a conversation', !/CONVERSATION/.test(W.castPrompt(ghibli)));
ok('the animal preset is never told it is a conversation', !/CONVERSATION/.test(W.castPrompt(animal)));

console.log('\n--- buildStory writes the lines ---');
const meta = { description: 'd', moral: 'm', target_audience: 'a' };
const talkScenes = [
    { scene_title: 'Hook', dialogue: [
        { speaker: 'Vera', line: 'Sit down, child.' },
        { speaker: 'Nadia', line: 'What if his anger is because he cares too much?' },
    ], narrative_context: 'x', characters: ['vera', 'nadia'] },
    { scene_title: 'Rule', dialogue: [
        { speaker: 'Vera', line: 'Then he loves you loudly and listens quietly.' },
        { speaker: 'Nadia', line: 'That is the same thing.' },
    ], narrative_context: 'y', characters: ['vera', 'nadia'] },
];
const talkStory = W.buildStory(talk, cast, meta, talkScenes);
ok('records the scope', talkStory.narration_scope === 'dialogue');
ok('is not narrated', talkStory.narrated === false);
ok('is not a silent cast', talkStory.silent_cast === false);
ok('carries no narrator voice', !('narrator_voice' in talkStory));
ok('script_line is empty, not missing', talkStory.scenes[0].script_line === '');
ok('clip 1 carries both lines', talkStory.scenes[0].dialogue.length === 2);
ok('the speaker is kept as spelled', talkStory.scenes[0].dialogue[0].speaker === 'Vera');
ok('clip 2 keeps its own exchange', talkStory.scenes[1].dialogue.length === 2);
ok('a model that returns a script_line has it cleared', (() => {
    const s = W.buildStory(talk, cast, meta, [
        { scene_title: 'T', script_line: 'She said nothing at all.',
          dialogue: [{ speaker: 'Vera', line: 'x' }], narrative_context: 'x', characters: ['vera'] },
    ]);
    return s.scenes[0].script_line === '' && !/She said nothing/.test(s.scenes[0].veo3_prompt);
})());
ok('the AUDIO tag attributes each line',
   /\[AUDIO\] Vera \(on screen, speaking\): "Sit down, child\."\s{2}Nadia \(on screen, speaking\): "What if his anger/.test(talkStory.scenes[0].veo3_prompt));
ok('a wordless clip says so rather than leaving it blank', (() => {
    const s = W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [], narrative_context: 'x', characters: ['vera'] },
    ]);
    return /\[AUDIO\] No dialogue in this clip\. Room tone/.test(s.scenes[0].veo3_prompt);
})());
ok('no clip claims a narrator', !/Narrator/.test(talkStory.scenes[0].veo3_prompt + talkStory.scenes[1].veo3_prompt));
ok('blank lines are dropped', (() => {
    const s = W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [{ speaker: 'Vera', line: '   ' }, { speaker: '', line: 'x' },
                                       { speaker: 'Nadia', line: 'Real.' }],
          narrative_context: 'x', characters: ['nadia'] },
    ]);
    return s.scenes[0].dialogue.length === 1 && s.scenes[0].dialogue[0].line === 'Real.';
})());
ok('a plain story is still narrated', W.buildStory(ghibli, cast, meta,
    [{ scene_title: 'T', script_line: 'A line.', narrative_context: 'x', characters: ['vera'] }]).narrated === true);
ok('a plain story has no dialogue key', !('dialogue' in W.buildStory(ghibli, cast, meta,
    [{ scene_title: 'T', script_line: 'A line.', narrative_context: 'x', characters: ['vera'] }]).scenes[0]));

console.log('\n--- validate ---');
const okStory = talkStory;
ok('accepts a well-formed dialogue story',
   W.validate(okStory, cast, talk).length === 0, W.validate(okStory, cast, talk).join(' | '));
// buildStory clears a stray script_line by construction, so this check guards
// the hand-edited and legacy JSON that never went through it.
ok('rejects a script_line', (() => {
    const s = W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [{ speaker: 'Vera', line: 'x' }],
          narrative_context: 'x', characters: ['vera'] },
    ]);
    s.scenes[0].script_line = 'She said nothing.';
    const bad = W.validate(s, cast, talk);
    return bad.length === 1 && /there is no narrator/.test(bad[0]);
})());
ok('rejects a clip with nobody speaking', (() => {
    const bad = W.validate(W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [], narrative_context: 'x', characters: ['vera'] },
    ]), cast, talk);
    return bad.length === 1 && /every clip needs a line/.test(bad[0]);
})());
ok('rejects a speaker who was never designed', (() => {
    const bad = W.validate(W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [{ speaker: 'Arthur', line: 'Hello.' }],
          narrative_context: 'x', characters: ['arthur'] },
    ]), cast, talk);
    return bad.some(b => /"Arthur" speaks but is not in the cast/.test(b));
})());
ok('rejects a speaker who is not on screen in that clip', (() => {
    const bad = W.validate(W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [{ speaker: 'Nadia', line: 'Hello.' }],
          narrative_context: 'x', characters: ['vera'] },
    ]), cast, talk);
    return bad.some(b => /"Nadia" speaks but is not listed in characters/.test(b));
})());
ok('rejects an empty line', (() => {
    const s = W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [{ speaker: 'Vera', line: 'ok' }], narrative_context: 'x', characters: ['vera'] },
    ]);
    s.scenes[0].dialogue[0].line = '   ';
    const bad = W.validate(s, cast, talk);
    return bad.some(b => /has no words in it/.test(b));
})());
ok('rejects a line with no speaker', (() => {
    const s = W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [{ speaker: 'Vera', line: 'ok' }], narrative_context: 'x', characters: ['vera'] },
    ]);
    s.scenes[0].dialogue[0].speaker = '';
    const bad = W.validate(s, cast, talk);
    return bad.some(b => /has no speaker/.test(b));
})());
ok('rejects an exchange too long to be said in the clip', (() => {
    const bad = W.validate(W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [
            { speaker: 'Vera', line: Array(20).fill('word').join(' ') },
            { speaker: 'Nadia', line: Array(20).fill('word').join(' ') },
        ], narrative_context: 'x', characters: ['vera', 'nadia'] },
    ]), cast, talk);
    return bad.some(b => /40 spoken words across 2 line\(s\), over the 30-word limit/.test(b));
})());
ok('accepts an exchange inside the budget', (() => {
    const bad = W.validate(W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [
            { speaker: 'Vera', line: 'Sit down, child.' },
            { speaker: 'Nadia', line: 'He only shouts because he loves me.' },
            { speaker: 'Vera', line: 'Then he loves you loudly and listens quietly.' },
        ], narrative_context: 'x', characters: ['vera', 'nadia'] },
    ]), cast, talk);
    return bad.length === 0;
})());
ok('a ghibli story is still judged the old way', (() => {
    const bad = W.validate(W.buildStory(ghibli, cast, meta,
        [{ scene_title: 'T', script_line: '', narrative_context: 'x', characters: [] }]), cast, ghibli);
    return bad.some(b => /the agent would INVENT this scene/.test(b));
})());

console.log('\n--- the style bible ---');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-talk-'));
function writeInto(name, preset, c, scenes) {
    const dir = path.join(tmp, name);
    const story = W.buildStory(preset, c, meta, scenes);
    W.writePackage(dir, preset, story, c);
    return { dir, story };
}
const talkOut = writeInto('talk', talk, W.normaliseCast(talk, cast), talkScenes);
const talkBible = fs.readFileSync(path.join(talkOut.dir, 'style_bible.md'), 'utf8');
ok('the bible has a Voices section', /## Voices\n/.test(talkBible));
ok('and says there is no narrator', /No narrator and no voice-over/.test(talkBible));
ok('it has no Narrator section', !/## Narrator/.test(talkBible));
ok('it prints the script', /## Script\n/.test(talkBible));
ok('with the speaker attributed', /\*\*Vera:\*\* "Sit down, child\."/.test(talkBible));

// A hand-edited story, which is the only way a wordless clip reaches the
// converter: `validate` rejects one, and buildStory clears a stray script_line.
// Built through buildStory so its veo3_prompt tells the truth about the gap -
// the converter recovers lines from that tag, so a fixture that merely emptied
// the array would still convert its dialogue and prove nothing.
const sparseScenes = [
    talkScenes[0],
    { scene_title: 'Silent beat', dialogue: [], narrative_context: 'y', characters: ['vera'] },
];
const sparseOut = writeInto('sparse', talk, W.normaliseCast(talk, cast), sparseScenes);
const sparseBible = fs.readFileSync(path.join(sparseOut.dir, 'style_bible.md'), 'utf8');
ok('the bible marks a wordless beat', /\(silent beat\)/.test(sparseBible));

const ghibliOut = writeInto('plain', ghibli, W.normaliseCast(ghibli, cast),
    [{ scene_title: 'T', script_line: 'A line.', narrative_context: 'x', characters: ['vera'] }]);
const ghibliBible = fs.readFileSync(path.join(ghibliOut.dir, 'style_bible.md'), 'utf8');
ok('a plain bible keeps its Narrator section', /## Narrator\n/.test(ghibliBible));
ok('a plain bible has no Voices section', !/## Voices/.test(ghibliBible));
ok('a plain bible has no Script section', !/## Script/.test(ghibliBible));

console.log('\n--- the converter emits the spoken mode ---');
const CONV = path.join(__dirname, 'story_to_agent_prompt.js');
function convert(story, dir, name) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(story, null, 2) + '\n', 'utf8');
    return execFileSync(process.execPath, [CONV, p, '--print'], { encoding: 'utf8' });
}
const conv = convert(talkOut.story, talkOut.dir, 'talk_story.json');
ok('names the mode in the header', /SPOKEN DIALOGUE VIDEO, not a narrated one/.test(conv));
ok('states there is no narrator', /There is NO narrator and NO voice-over anywhere/.test(conv));
ok('forbids voicing the story', /do not voice the story yourself/.test(conv));
ok('says the lines are spoken on screen', /spoken by one of the characters, ON SCREEN/.test(conv));
ok('asks for visible speaking', /mouths move, they look at each/.test(conv));
ok('forbids invented lines', /Do not invent any line that is not in the DIALOGUE block/.test(conv));
ok('keeps the room consistent', /same two\s+people stay in the same room/.test(conv));
ok('emits a DIALOGUE block', /DIALOGUE \(spoken on screen, read exactly\):/.test(conv));
ok('attributes the first line', /^  Vera: "Sit down, child\."$/m.test(conv));
ok('attributes the second speaker', /^  Nadia: "What if his anger is because he cares too much\?"$/m.test(conv));
ok('never emits a NARRATION line', !/NARRATION/.test(conv));
ok('never promises a voice-over in every clip',
   !/Every clip carries an off-screen narrator voice-over/.test(conv));
ok('never says no scene may drop its voice-over', !/no scene may drop its voice-over/.test(conv));
ok('never says characters are silent', !/Mouths closed/.test(conv));
ok('the closing rule forbids a narrator',
   /Nobody narrates this video\./.test(conv) && /no one describing what the camera is showing/.test(conv));
ok('the summary counts the spoken scenes', /dialogue\s+: 2\/2 scenes have spoken lines/.test(conv));
ok('the summary says the cast speak', /speaking\s+: DIALOGUE - the cast speak on screen, no narrator/.test(conv));
ok('and reports no narrator', /narrator\s+: \(none - dialogue video\)/.test(conv));
ok('and does not call the cast silent', /silent cast: no - the cast speak, that is the point/.test(conv));
ok('and does not threaten invented scenes', !/The agent will INVENT those scenes/.test(conv));
ok('and does not warn when every clip speaks', !/have no dialogue/.test(conv));

// A hand-edited story can leave a clip with nobody speaking. It has to survive
// conversion with the gap marked, and it must not be reported as a missing
// narration the agent should fill in.
const sparseConv = convert(sparseOut.story, sparseOut.dir, 'sparse_story.json');
ok('a wordless beat is marked, not filled in', /nobody speaks in this clip - a silent beat/.test(sparseConv));
ok('and warns about the wordless clip', /WARNING: 1 scene\(s\) have no dialogue/.test(sparseConv));
ok('and still never emits a NARRATION line', !/NARRATION/.test(sparseConv));
ok('and keeps the spoken clip intact', /^  Vera: "Sit down, child\."$/m.test(sparseConv));

console.log('\n--- the converter still handles the other modes ---');
const ghibliConv = convert(ghibliOut.story, ghibliOut.dir, 'ghibli_story.json');
ok('a narrated story is untouched', /Every clip carries an off-screen narrator voice-over/.test(ghibliConv));
ok('and still forbids character dialogue', /narration only/.test(ghibliConv));
ok('and emits no DIALOGUE block', !/DIALOGUE \(spoken on screen/.test(ghibliConv));
const animalOut = writeInto('animal', animal, [], [
    { scene_title: 'Hook', script_line: 'A dog waits at a gate.', sound_context: 'Wind and a bus.', narrative_context: 'x', characters: [] },
    { scene_title: 'Two', script_line: '', sound_context: 'Gravel under paws.', narrative_context: 'y', characters: [] },
]);
const animalConv = convert(animalOut.story, animalOut.dir, 'animal_story.json');
ok('the sound-led story is untouched', /SOUND-LED FILM with one spoken opening hook/.test(animalConv));
ok('and still emits its SOUND lines', /SOUND \(real sound of this scene, no voice-over\)/.test(animalConv));
ok('and emits no DIALOGUE block', !/DIALOGUE \(spoken on screen/.test(animalConv));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
