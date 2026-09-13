// Tests for `narration_scope: "intro"` - a preset that speaks only over the
// opening clip and lets the rest of the film run on its own sound and music.
// Covers the write path (preset -> prompts -> story JSON -> validation -> bible)
// and the convert path (story JSON -> agent prompt), plus the regression that
// every other preset is untouched.
// Run: node test_narration_scope.js     (no network)
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

const animal = W.loadPreset('animal-kindness');
const ghibli = W.loadPreset('ghibli');
const sci = W.loadPreset('science-what-if');

console.log('\n--- the preset declares the mode ---');
ok('narration_scope is intro', animal.narration_scope === 'intro', animal.narration_scope);
ok('carries a sound bed', !!animal.sound_style && animal.sound_style.length > 60);
ok('the sound bed names real sounds',
   /wind|gravel|engine|rain|kettle|breathing/i.test(animal.sound_style));
ok('forbids wall-to-wall narration', /no wall-to-wall narration/i.test(animal.avoid));
ok('forbids a swelling score', /no music that swells/i.test(animal.avoid));
ok('keeps a narrator voice', !!animal.narration_voice);

console.log('\n--- only the presets that ask for a mode declare one ---');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'styles.json'), 'utf8'));
const intro = db.styles.filter(p => p.narration_scope);
// Named in full rather than counted: each mode is opted into deliberately, so a
// third one appearing should be an edit to this line, not a silent pass.
ok('exactly the two intended presets declare narration_scope',
   intro.map(p => p.id).sort().join(', ') === 'animal-kindness, relationship-dialogue',
   intro.map(p => `${p.id}:${p.narration_scope}`).join(', '));
ok('the animal preset is the intro one',
   intro.find(p => p.id === 'animal-kindness').narration_scope === 'intro');
ok('the relationship preset is the dialogue one',
   intro.find(p => p.id === 'relationship-dialogue').narration_scope === 'dialogue');
const withSound = db.styles.filter(p => p.sound_style);
ok('exactly one preset declares sound_style', withSound.length === 1, withSound.map(p => p.id).join(', '));
ok('no preset declares an unknown scope',
   db.styles.every(p => !p.narration_scope || ['intro', 'dialogue'].includes(p.narration_scope)),
   db.styles.map(p => p.narration_scope).filter(Boolean).join(', '));
// A dialogue preset has nobody to narrate, so it must not carry a narrator's
// voice or a music bed - both would reach the prompts as instructions for a
// voice that never speaks.
ok('the dialogue preset declares no narrator voice',
   !intro.find(p => p.id === 'relationship-dialogue').narration_voice);
ok('the dialogue preset declares no sound bed',
   !intro.find(p => p.id === 'relationship-dialogue').sound_style);

console.log('\n--- the look block ---');
const animalLook = W.lookBlock(animal);
const ghibliLook = W.lookBlock(ghibli);
ok('the animal look block carries SOUND', /^SOUND: /m.test(animalLook));
ok('its narrator is scoped to the opening clip',
   /^NARRATOR: .*opening clip only, never again\.$/m.test(animalLook));
ok('ghibli has no SOUND line', !/^SOUND: /m.test(ghibliLook));
ok('ghibli keeps its narrator line verbatim',
   ghibliLook.includes(`NARRATOR: ${ghibli.narration_voice}\n`), ghibliLook.match(/^NARRATOR:.*$/m)?.[0]);
ok('ghibli keeps its NEVER line',
   ghibliLook.includes(`NEVER: ${ghibli.avoid}`));

console.log('\n--- scenesPrompt, sound-led branch ---');
const outline = Array.from({ length: 4 }, (_, i) => ({ title: 'T' + i, beat: 'B' + i }));
const introPrompt = W.scenesPrompt(animal, [], outline, 0, 4, []);
ok('explains the audio model', /AUDIO MODEL - this film is SOUND-LED, not narrated/.test(introPrompt));
ok('says the hook is the only narration', /That is the ONLY narration in the whole/.test(introPrompt));
ok('asks for sound_context', /"sound_context"/.test(introPrompt));
ok('confines script_line to clip 1', /ONLY on clip 1/.test(introPrompt));
ok('calls the line a hook', /it is the HOOK/.test(introPrompt));
ok('the JSON skeleton carries sound_context',
   /"scenes":\[\{"scene_title":"","script_line":"","sound_context":""/.test(introPrompt));
ok('a later batch is told to continue from the sound brief', (() => {
    const p2 = W.scenesPrompt(animal, [], outline, 2, 4,
        [{ script_line: '', sound_context: 'Rain on a tin roof.' }]);
    return /THE PREVIOUS CLIP ENDED LIKE THIS[\s\S]*Rain on a tin roof\./.test(p2);
})());
ok('and never quotes an empty continuation', (() => {
    const p2 = W.scenesPrompt(animal, [], outline, 2, 4,
        [{ script_line: '', sound_context: 'Rain on a tin roof.' }]);
    return !/ENDED LIKE THIS:\s*\n\s*""/.test(p2);
})());

const ghibliPrompt = W.scenesPrompt(ghibli, [{ name: 'Mira', description: 'x' }], outline, 0, 4, []);
ok('ghibli never hears about sound_context', !/sound_context/.test(ghibliPrompt));
ok('ghibli never hears the audio model', !/AUDIO MODEL/.test(ghibliPrompt));
ok('ghibli keeps the narration field wording',
   /"script_line"\s+- the NARRATION, spoken by the narrator/.test(ghibliPrompt));
ok('ghibli keeps the plain skeleton',
   /"scenes":\[\{"scene_title":"","script_line":"","narrative_context":"","characters":\[\]\}\]\}$/.test(ghibliPrompt));
ok('ghibli keeps its blank line after the look block',
   /NEVER: [^\n]*\n\nTHE CAST/.test(ghibliPrompt));

console.log('\n--- the outline step is told the film is sound-led ---');
const castPrompt = W.castPrompt(animal);
const ghibliCast = W.castPrompt(ghibli);
ok('the animal outline asks for visually-told beats', /This film is SOUND-LED/.test(castPrompt));
ok('and forbids a beat that needs narration', /No beat may need a line of narration/.test(castPrompt));
ok('ghibli is never told this', !/SOUND-LED/.test(ghibliCast));
ok('ghibli keeps its closing outline instruction verbatim',
   /Draw on these shapes that suit this look:\n(     - [^\n]*\n)*\nReturn ONLY this JSON/.test(ghibliCast));

console.log('\n--- buildStory writes the new fields only when asked ---');
const meta = { description: 'd', moral: 'm', target_audience: 'a' };
const introScenes = [
    { scene_title: 'Hook', script_line: 'A dog waits at a gate.', sound_context: 'Wind and a distant bus.', narrative_context: 'x', characters: [] },
    { scene_title: 'Two', script_line: '', sound_context: 'Gravel under paws.', narrative_context: 'y', characters: [] },
];
const introStory = W.buildStory(animal, [], meta, introScenes);
ok('the story records the scope', introStory.narration_scope === 'intro');
ok('clip 1 keeps its script_line', introStory.scenes[0].script_line === 'A dog waits at a gate.');
ok('clip 2 has no script_line', introStory.scenes[1].script_line === '');
ok('every clip carries a sound brief',
   introStory.scenes.every(s => typeof s.sound_context === 'string'));
ok('clip 1 keeps the narrator AUDIO tag',
   /\[AUDIO\] Narrator \(V\.O\., .*\): "A dog waits at a gate\."/.test(introStory.scenes[0].veo3_prompt));
ok('clip 2 gets a sound-only AUDIO tag',
   /\[AUDIO\] No voice-over in this clip\. Natural sound only: Gravel under paws\./.test(introStory.scenes[1].veo3_prompt));
ok('no clip 2 prompt claims a narrator',
   !/Narrator/.test(introStory.scenes[1].veo3_prompt));

const plainStory = W.buildStory(ghibli, [{ name: 'Mira', description: 'x' }], meta,
    [{ scene_title: 'T', script_line: 'A line.', narrative_context: 'x', characters: ['Mira'] }]);
ok('a plain story has no narration_scope key', !('narration_scope' in plainStory));
ok('a plain story has no sound_context key', !('sound_context' in plainStory.scenes[0]));
ok('a plain story keeps its AUDIO tag verbatim',
   /\[AUDIO\] Narrator \(V\.O\., .*\): "A line\."/.test(plainStory.scenes[0].veo3_prompt));
ok('a plain story writes narrated: true', plainStory.narrated === true);

console.log('\n--- validate ---');
function introFor(scenes) { return W.buildStory(animal, [], meta, scenes); }
ok('accepts a well-formed sound-led story',
   W.validate(introStory, [], animal).length === 0, W.validate(introStory, [], animal).join(' | '));
ok('rejects narration after clip 1', (() => {
    const bad = W.validate(introFor([
        introScenes[0],
        { ...introScenes[1], script_line: 'And then the dog walked on.' },
    ]), [], animal);
    return bad.length === 1 && /narrates the opening clip only/.test(bad[0]);
})());
ok('rejects a silent clip 1', (() => {
    const bad = W.validate(introFor([
        { ...introScenes[0], script_line: '' },
        introScenes[1],
    ]), [], animal);
    return bad.some(b => /clip 1: no script_line/.test(b) && /opening hook/.test(b));
})());
ok('rejects a clip with no sound brief', (() => {
    const bad = W.validate(introFor([
        introScenes[0],
        { ...introScenes[1], sound_context: '' },
    ]), [], animal);
    return bad.length === 1 && /no sound_context/.test(bad[0]) && /would be silent/.test(bad[0]);
})());
ok('still enforces the word budget on the hook', (() => {
    const bad = W.validate(introFor([
        { ...introScenes[0], script_line: Array(40).fill('word').join(' ') },
        introScenes[1],
    ]), [], animal);
    return bad.some(b => /over the 28-word limit/.test(b));
})());
ok('a preset with no scope is judged the old way', (() => {
    const bad = W.validate(W.buildStory(ghibli, [], meta,
        [{ scene_title: 'T', script_line: '', narrative_context: 'x', characters: [] }]), [], ghibli);
    return bad.some(b => /the agent would INVENT this scene/.test(b));
})());

console.log('\n--- the style bible ---');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-scope-'));
function writeInto(name, preset, cast, scenes) {
    const dir = path.join(tmp, name);
    const story = W.buildStory(preset, cast, meta, scenes);
    W.writePackage(dir, preset, story, cast);
    return { dir, story };
}
const animalOut = writeInto('intro', animal, [], introScenes);
const animalBible = fs.readFileSync(path.join(animalOut.dir, 'style_bible.md'), 'utf8');
ok('the bible has a Sound section', /## Sound\n/.test(animalBible));
ok('and carries the sound bed', animalBible.includes(animal.sound_style));
ok('the Narrator section is scoped',
   /## Narrator\n[^\n]*\n\nHeard over the opening clip only\./.test(animalBible));
ok('and says the later clips are wordless', /Clips 2 onward carry no voice-over/.test(animalBible));

const ghibliOut = writeInto('plain', ghibli,
    [{ name: 'Mira', description: 'Same Mira throughout.', sheet_prompt: 'a woman' }],
    [{ scene_title: 'T', script_line: 'A line.', narrative_context: 'x', characters: ['Mira'] }]);
const ghibliBible = fs.readFileSync(path.join(ghibliOut.dir, 'style_bible.md'), 'utf8');
ok('a plain bible has no Sound section', !/## Sound/.test(ghibliBible));
ok('a plain bible has no scoping note', !/opening clip only/.test(ghibliBible));
ok('a plain bible goes Narrator straight to Never',
   new RegExp(`## Narrator\\n${ghibli.narration_voice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n## Never`).test(ghibliBible),
   ghibliBible.match(/## Narrator[\s\S]{0,200}/)?.[0]);

console.log('\n--- the converter emits the third mode ---');
const CONV = path.join(__dirname, 'story_to_agent_prompt.js');
const storyPath = path.join(animalOut.dir, 'probe_story.json');
fs.writeFileSync(storyPath, JSON.stringify(animalOut.story, null, 2) + '\n', 'utf8');
const conv = execFileSync(process.execPath, [CONV, storyPath, '--print'], { encoding: 'utf8' });
ok('names the mode in the header', /SOUND-LED FILM with one spoken opening hook/.test(conv));
ok('confines the voice-over to clip 1', /CLIP 1 ONLY has a voice-over/.test(conv));
ok('forbids narration in the later clips', /NO voice-over and NO narration of any kind/.test(conv));
ok('tells the clips to follow their sound line', /driven by their SOUND line/.test(conv));
ok('warns a quiet clip is a clip to redo', /comes back quiet is a clip to redo/.test(conv));
ok('describes the music bed', /One restrained music bed runs under the whole film/.test(conv));
ok('never promises a voice-over in every clip',
   !/Every clip carries an off-screen narrator voice-over/.test(conv));
ok('never forbids dropping a voice-over', !/no scene may drop its voice-over/.test(conv));
ok('clip 1 keeps its narration line',
   /NARRATION \(voice-over, read exactly\): "A dog waits at a gate\."/.test(conv));
ok('clip 2 gets a sound line', /SOUND \(real sound of this scene, no voice-over\): Gravel under paws\./.test(conv));
ok('clip 2 has no NARRATION line at all', !/NARRATION/.test(conv.split('Scene 2')[1] || ''));
ok('the old "(none found)" placeholder is gone', !/none found in the story JSON/.test(conv));
ok('the closing rule names the one spoken line',
   /The only spoken words in the whole video are clip 1's voice-over/.test(conv));
ok('the summary says hook only', /narrated\s+: HOOK ONLY/.test(conv));
ok('the summary counts the sound briefs', /sound\s+: 2\/2 scenes have a sound brief/.test(conv));
ok('and does not warn about the deliberate silence',
   !/The agent will INVENT those scenes/.test(conv));

console.log('\n--- the converter is unchanged for every other story ---');
const plainPath = path.join(ghibliOut.dir, 'plain_story.json');
fs.writeFileSync(plainPath, JSON.stringify(ghibliOut.story, null, 2) + '\n', 'utf8');
const plainConv = execFileSync(process.execPath, [CONV, plainPath, '--print'], { encoding: 'utf8' });
ok('a plain story is still announced as narrated',
   /Every clip carries an off-screen narrator voice-over/.test(plainConv));
ok('and still says no scene may drop it', /no scene may drop its voice-over/.test(plainConv));
ok('and keeps the old closing rule',
   /Do not add any character dialogue anywhere - narration only\./.test(plainConv));
ok('and emits no SOUND line', !/^SOUND/m.test(plainConv));
ok('and keeps the old summary warning path', /narrated\s+: YES - voice-over rules added/.test(plainConv));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
