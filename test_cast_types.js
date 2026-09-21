// Tests for typed casts: a preset that declares `cast_types` (an animal
// kindness film has an animal AND a person) gets per-type identity profiles and
// per-type reference sheet instructions, and may carry its own default length.
// Run: node test_cast_types.js     (no network)
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
const real = W.loadPreset('relationship-dialogue-real');
const manhwa = W.loadPreset('relationship-dialogue');

console.log('\n--- the new preset is well formed ---');
ok('exists', !!animal);
ok('has an id and label', animal.id === 'animal-kindness' && !!animal.label);
ok('cast is required', animal.cast === 'required');
ok('declares both cast types', JSON.stringify(animal.cast_types) === '["animal","human"]',
   JSON.stringify(animal.cast_types));
ok('carries its own length', animal.default_duration === 80, String(animal.default_duration));
ok('names no real studio', !/studio|pixar|disney|ghibli|nasa|esa|imax/i.test(
    [animal.style, animal.whisk, animal.cast_idiom].join(' ')), animal.style);
ok('has story shapes', (animal.story_shapes || []).length >= 3);
ok('has a narration voice', !!animal.narration_voice);
ok('has direction', !!animal.direction && animal.direction.length > 40);
ok('cast template covers animals and humans',
   /ANIMALS/.test(animal.cast_idiom) && /HUMANS/.test(animal.cast_idiom));
ok('forbids on-screen text', /no on-screen text/i.test(animal.avoid));
ok('forbids watermarks and subtitles',
   /watermarks/i.test(animal.avoid) && /subtitles/i.test(animal.avoid));
// Phrased as one "no X, Y or Z" clause rather than repeating "no" - assert the
// meaning, not the punctuation.
ok('forbids cartoon anatomy', /no cartoon,\s*anime or stylised anatomy/i.test(animal.avoid));
ok('forbids dialogue', /no dialogue/i.test(animal.avoid));
ok('forbids floating objects', /floating objects/i.test(animal.avoid));

console.log('\n--- only the typed presets declare types ---');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'styles.json'), 'utf8'));
const typed = db.styles.filter(p => Array.isArray(p.cast_types));
// Named in full rather than counted: the point is that each genre which opts in
// gets a per-type identity profile and the rest are untouched, so a third one
// appearing should be a deliberate edit to this line, not a silent pass.
ok('exactly the three intended presets declare cast_types',
   typed.map(p => p.id).sort().join(', ') ===
   'animal-kindness, relationship-dialogue, relationship-dialogue-real',
   typed.map(p => p.id).join(', '));
ok('every declared cast type is one the prompts know how to describe',
   typed.every(p => p.cast_types.every(t => ['animal', 'human'].includes(t))),
   typed.map(p => `${p.id}:${p.cast_types.join('|')}`).join(', '));
const withDuration = db.styles.filter(p => p.default_duration);
ok('exactly one preset declares default_duration', withDuration.length === 1,
   withDuration.map(p => p.id).join(', '));
ok('every default_duration is a positive number',
   withDuration.every(p => Number.isInteger(p.default_duration) && p.default_duration > 0));

console.log('\n--- the cast prompt branches on type ---');
const animalCast = W.castPrompt(animal);
const ghibliCast = W.castPrompt(ghibli);
ok('asks for a type field', /"type"\s+- one of: animal, human/.test(animalCast));
ok('gives the animal identity profile', /animal - the exact breed or mix/.test(animalCast));
ok('demands two unchanging markers', /TWO unchanging physical markers/.test(animalCast));
ok('explains why the markers matter', /different animal in every clip/.test(animalCast));
ok('gives the human identity profile', /human\s+- age, build, hair, face and skin tone/.test(animalCast));
ok('asks for one animal and one human', /TWO characters: one animal, one human/.test(animalCast));
ok('explains the three-image ceiling', /at most 3 reference images/.test(animalCast));
ok('still requires an animal', /never a cast of people alone/.test(animalCast));
ok('animal sheet asks for several angles, not one view', /SEVERAL ANGLES/.test(animalCast));
ok('the animal close-up is specified as the head', /close-up is of the\s+head/.test(animalCast));
ok('the animal sheet must keep the markers readable in every view',
   /markers must\s+stay readable in every view/.test(animalCast));
ok('animal markers must be visible in the sheet',
   /Every physical marker must be visible/.test(animalCast));
ok('JSON skeleton carries the type field', /"characters":\[\{"name":"","type":"",/.test(animalCast));

ok('a preset with no cast_types asks for no type', !/"type"/.test(ghibliCast));
ok('ghibli keeps its own description rule', /State age, build,/.test(ghibliCast));
ok('ghibli keeps its own sheet rule', /repeated from SEVERAL ANGLES/.test(ghibliCast));
ok('ghibli is still about people', /This genre is about people/.test(ghibliCast));
ok('the grey background rule is unchanged in both',
   /"plain neutral grey studio background"/.test(animalCast) &&
   /"plain neutral grey studio background"/.test(ghibliCast));

console.log('\n--- direction reaches the look block ---');
ok('animal look block carries DIRECTION', /^DIRECTION: /m.test(W.lookBlock(animal)));
ok('ghibli look block has no DIRECTION line', !/^DIRECTION: /m.test(W.lookBlock(ghibli)));
ok('direction is not smuggled into the style',
   !/head turns/.test(animal.style), animal.style);

console.log('\n--- normaliseCast ---');
const singleType = { label: 'X', cast_types: ['animal'] };
const twoTypes = { label: 'X', cast_types: ['animal', 'human'] };
ok('fills the type when the preset allows only one',
   W.normaliseCast(singleType, [{ name: 'Rex' }])[0].type === 'animal');
ok('keeps a type the preset allows',
   W.normaliseCast(twoTypes, [{ name: 'Rex', type: 'animal' }])[0].type === 'animal');
ok('leaves the type blank when two are possible and none was given',
   W.normaliseCast(twoTypes, [{ name: 'Rex' }])[0].type === '');
ok('replaces a type the preset does not allow when only one is possible',
   W.normaliseCast(singleType, [{ name: 'Rex', type: 'dragon' }])[0].type === 'animal');
ok('clears the type when the preset declares none',
   W.normaliseCast(ghibli, [{ name: 'Mira', type: 'animal' }])[0].type === '');
ok('tolerates a missing list', W.normaliseCast(ghibli, undefined).length === 0);
ok('does not mutate the input', (() => {
    const input = [{ name: 'Rex' }];
    W.normaliseCast(singleType, input);
    return input[0].type === undefined;
})());
ok('upper case types are normalised',
   W.normaliseCast(twoTypes, [{ name: 'Rex', type: 'ANIMAL' }])[0].type === 'animal');

console.log('\n--- validate ---');
const meta = { description: 'd', moral: 'm', target_audience: 'a' };
const oneScene = [{ scene_title: 'T', script_line: 'A short line.', narrative_context: 'A lane.', characters: ['Rex'] }];
function storyFor(cast) { return W.buildStory(animal, cast, meta, oneScene); }
ok('accepts a valid type',
   W.validate(storyFor([{ name: 'Rex', type: 'animal' }]), [{ name: 'Rex', type: 'animal' }], animal).length === 0);
ok('accepts a missing type', (() => {
    const c = [{ name: 'Rex', type: '' }];
    return W.validate(storyFor(c), c, animal).length === 0;
})());
ok('rejects a type the preset does not allow', (() => {
    const c = [{ name: 'Rex', type: 'dragon' }];
    const bad = W.validate(storyFor(c), c, animal);
    return bad.length === 1 && /does not allow/.test(bad[0]);
})());
ok('still rejects a scene with no characters when a cast exists',
   W.validate(W.buildStory(animal, [{ name: 'Rex', type: 'animal' }], meta,
       [{ scene_title: 'T', script_line: 'A line.', narrative_context: 'x', characters: [] }]),
       [{ name: 'Rex', type: 'animal' }], animal).length === 1);
ok('a preset arg is optional (older callers still work)',
   W.validate(storyFor([{ name: 'Rex', type: 'animal' }]), [{ name: 'Rex', type: 'animal' }]).length === 0);

console.log('\n--- reference sheets ---');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-cast-'));
function writeInto(name, preset, cast) {
    const dir = path.join(tmp, name);
    const scenes = cast.map((c, i) => ({
        scene_title: 'T' + i, script_line: 'A line.', narrative_context: 'A lane.',
        characters: [c.name],
    }));
    const story = W.buildStory(preset, cast, meta, scenes.length ? scenes : oneScene);
    W.writePackage(dir, preset, story, cast);
    return { dir, story };
}
const mixed = W.normaliseCast(animal, [
    { name: 'Rusty', type: 'animal', description: 'Same Rusty throughout - a lean brown dog.', sheet_prompt: 'a dog' },
    { name: 'Ilan', type: 'human', description: 'Same Ilan throughout - a tired man.', sheet_prompt: 'a man' },
]);
const mixedOut = writeInto('mixed', animal, mixed);
const sheets = fs.readFileSync(path.join(mixedOut.dir, 'character_sheets.txt'), 'utf8');
ok('one sheet entry per character', (sheets.match(/^=== /gm) || []).length === 2);
ok('the animal entry is labelled', /=== RUSTY ===\s+\(animal\)/.test(sheets));
ok('the human entry is labelled', /=== ILAN ===\s+\(human\)/.test(sheets));
ok('the animal entry asks for several angles', /This is an ANIMAL - one image, several angles/.test(sheets));
// The sheets file is hard-wrapped for reading, so allow the wrap.
ok('the animal entry requires the markers be visible',
   /Every\s+physical marker listed below must be visible somewhere/.test(sheets));
ok('the human entry gets no animal note', !/=== ILAN ===\s+\(human\)\s*\nThis is an ANIMAL/.test(sheets));
ok('the header says each sheet shows several angles',
   /showing the same individual from several\s+angles/.test(sheets));
ok('the header no longer forbids a multi-angle sheet', !/Do not make a multi-angle sheet/.test(sheets));
// A Flow Character is re-invented for every clip, which is what made the cast
// drift. The sheets file used to instruct the user to make one per character,
// so following it by hand reproduced the very bug the pipeline was fixed for.
ok('the header no longer sends you to the Flow Character tab',
   !/upload it into Flow as a Character/i.test(sheets));
ok('the header says where the sheets actually belong',
   /character_refs\//.test(sheets));
ok('the header warns that a Flow Character drifts',
   /drift from cut to cut/.test(sheets));

const mixedBible = fs.readFileSync(path.join(mixedOut.dir, 'style_bible.md'), 'utf8');
ok('the style bible no longer sends you to the Flow Character tab',
   !/Upload each into Flow as a Character/i.test(mixedBible));
ok('the style bible points at character_refs/',
   /into `character_refs\/`/.test(mixedBible));
// The prompt used to be emitted twice under the marker, so the reader pasted
// the same image prompt into the generator back to back.
ok('one image-prompt marker per character', (sheets.match(/-- image prompt --/g) || []).length === 2);
ok('the image prompt text is printed once, not twice',
   (sheets.match(/^a dog$/gm) || []).length === 1, 'the dog sheet_prompt is duplicated');
ok('and the second character\'s prompt is not duplicated either',
   (sheets.match(/^a man$/gm) || []).length === 1);
ok('character_refs is created for a cast', fs.existsSync(path.join(mixedOut.dir, 'character_refs')));

const humanCast = W.normaliseCast(ghibli, [
    { name: 'Mira', description: 'Same Mira throughout - a young woman.', sheet_prompt: 'a woman' },
]);
const humanOut = writeInto('human', ghibli, humanCast);
const humanSheets = fs.readFileSync(path.join(humanOut.dir, 'character_sheets.txt'), 'utf8');
ok('a human-only cast gets no animal note', !/This is an ANIMAL/.test(humanSheets));
ok('a human-only cast still gets the several-angles header',
   /showing the same individual from several\s+angles/.test(humanSheets));
ok('a human-only entry carries no type label', /=== MIRA ===\n/.test(humanSheets));

const noCastOut = writeInto('nocast', sci, []);
ok('a no-cast story writes no sheets file',
   !fs.existsSync(path.join(noCastOut.dir, 'character_sheets.txt')));
ok('a no-cast story writes no character_refs folder',
   !fs.existsSync(path.join(noCastOut.dir, 'character_refs')));

console.log('\n--- the type never leaks into the story JSON ---');
ok('no "type" key in the written story', !/"type"/.test(JSON.stringify(mixedOut.story)));
ok('no cast_types in the written story', !/cast_types/.test(JSON.stringify(mixedOut.story)));
ok('character_descriptions are plain strings',
   Object.values(mixedOut.story.character_descriptions).every(v => typeof v === 'string'));
ok('references point at the refs folder',
   mixedOut.story.character_references.rusty === './character_refs/rusty.jpg');

console.log('\n--- the realistic twin of the dialogue preset ---');
// Same film, same rules, a filmed look instead of a drawn one. It exists as a
// separate preset rather than an edit so the manhwa version survives, which
// makes "did the look actually change?" the only thing worth asserting - a twin
// that still carries one drawn-medium field produces a photoreal cast standing
// in an illustrated room, which reads worse than staying cartoon.
ok('exists', !!real && real.id === 'relationship-dialogue-real');
ok('has a label that says which one it is', /realistic/i.test(real.label), real.label);
ok('it is the same kind of film', real.kind === manhwa.kind);
ok('still a spoken two-hander', real.narration_scope === 'dialogue');
ok('still requires a human cast',
   real.cast === 'required' && JSON.stringify(real.cast_types) === '["human"]');
ok('keeps the locked camera the dialogue mode needs',
   real.camera === manhwa.camera);
ok('keeps the locked blocking', real.blocking === manhwa.blocking);
ok('neither hardcodes a place any more',
   !real.setting && !manhwa.setting && !manhwa.setting_name && !real.setting_prompt);
ok('has the same story shapes', JSON.stringify(real.story_shapes) === JSON.stringify(manhwa.story_shapes));

// The positive wording is what the model copies. The negatives after NOT are
// deliberate, so split them off rather than searching the whole field.
const posOf = (s) => String(s).split(/\bNOT\b/)[0];
ok('the look is photographic', /photorealistic/i.test(real.style), real.style);
ok('the look names no drawn medium',
   !/manhwa|cel-shaded|illustration|cartoon|anime/i.test(posOf(real.style)), real.style);
ok('the cast template is photographic',
   /photorealistic/i.test(posOf(real.cast_idiom)), real.cast_idiom);
ok('and describes real skin rather than a style',
   /skin texture|pores/i.test(real.cast_idiom), real.cast_idiom);
ok('the cast template names no drawn medium in its positive half',
   !/manhwa|cel-shaded|illustration|cartoon|anime/i.test(posOf(real.cast_idiom)), posOf(real.cast_idiom));
ok('and rules the drawn media out explicitly',
   /NOT illustration/i.test(real.cast_idiom) && /NOT cartoon/i.test(real.cast_idiom));
// The plate is no longer baked into a preset: each story supplies its own place
// prompt, rendered in the preset's medium, so what must hold is that the two
// presets still disagree on the medium everywhere it is written.
ok('neither preset hardcodes a place plate any more',
   !real.setting_prompt && !manhwa.setting_prompt);
ok('and the cast templates are cleanly opposed on the medium',
   /illustration/i.test(posOf(manhwa.cast_idiom)) &&
   !/illustration|anime|manhwa/i.test(posOf(real.cast_idiom)));
// The other half of the trap: the manhwa preset bans photographic realism, so a
// copy of that list would tell the story writer to do the opposite of the brief.
ok('the avoid list no longer bans photography',
   !/photographic realism|no live-action/i.test(real.avoid), real.avoid);
ok('it bans the drawn media instead',
   /no cartoon/i.test(real.avoid) && /no illustration/i.test(real.avoid), real.avoid);
// The twin was made by copying this preset and changing the medium, so the risk
// is not that the twin is wrong - it is that the copy edited the original in
// place. What must survive is that the two presets disagree on the medium and
// agree on nothing else: the drawn one rejects a photograph, the filmed one
// rejects a cartoon, and neither has drifted into the other's list.
ok('the drawn preset still rejects photography',
   /NOT a photograph/i.test(manhwa.cast_idiom) && /no live-action or photographic realism/i.test(manhwa.avoid));
ok('and asks for a drawn medium',
   /2\.5D semi-realistic|illustration/i.test(manhwa.cast_idiom), manhwa.cast_idiom);
ok('the two presets disagree on the medium',
   /photorealistic/i.test(posOf(real.cast_idiom)) && !/photorealistic/i.test(posOf(manhwa.cast_idiom)));
ok('and each bans what the other asks for', (() => {
    const realBansDrawn = /no cartoon/i.test(real.avoid) && /no illustration/i.test(real.avoid);
    const manhwaBansFilmed = /no live-action or photographic realism/i.test(manhwa.avoid);
    return realBansDrawn && manhwaBansFilmed;
})());
ok('both presets are offered side by side', (() => {
    const ids = db.styles.map(p => p.id);
    return ids.includes('relationship-dialogue') && ids.includes('relationship-dialogue-real');
})());

console.log('\n--- the preset supplies the length (real CLI, no network) ---');
const CLI = path.join(__dirname, 'write_story.js');
function dry(args) {
    return execFileSync(process.execPath, [CLI, '--title', 'Probe', '--dry-run', ...args],
        { encoding: 'utf8' });
}
const auto = dry(['--preset', 'animal-kindness']);
ok('animal preset defaults to 80s -> 10 clips', /duration : 80s {2}-> {2}10 clips/.test(auto), auto.match(/duration.*/)?.[0]);
ok('and says where the number came from', /the Animal Kindness preset's own length/.test(auto));
ok('its outline asks for 10 beats', /exactly 10 entries/.test(auto));

const forced = dry(['--preset', 'animal-kindness', '--duration', '56']);
ok('an explicit --duration wins', /duration : 56s {2}-> {2}7 clips/.test(forced), forced.match(/duration.*/)?.[0]);
ok('and is not blamed on the preset', !/preset's own length/.test(forced));
ok('its outline asks for 7 beats', /exactly 7 entries/.test(forced));

const plain = dry(['--preset', 'ghibli']);
ok('a preset with no length keeps the 56s default', /duration : 56s {2}-> {2}7 clips/.test(plain));
ok('and does not claim the preset set it', !/preset's own length/.test(plain));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
