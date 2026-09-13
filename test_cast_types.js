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
ok('exactly the two intended presets declare cast_types',
   typed.map(p => p.id).sort().join(', ') === 'animal-kindness, relationship-dialogue',
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
ok('animal sheet is a single three-quarter view', /three-quarter view/.test(animalCast));
ok('animal sheet warns a multi-view sheet counts as several',
   /multi-view sheet counts as more than one/.test(animalCast));
ok('animal markers must be visible in the sheet',
   /Every physical marker must be visible/.test(animalCast));
ok('JSON skeleton carries the type field', /"characters":\[\{"name":"","type":"",/.test(animalCast));

ok('a preset with no cast_types asks for no type', !/"type"/.test(ghibliCast));
ok('ghibli keeps its own description rule', /State age, build,/.test(ghibliCast));
ok('ghibli keeps its own sheet rule', /reference sheet: full body, neutral standing/.test(ghibliCast));
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
ok('the animal entry demands a single image', /This is an ANIMAL - one image only/.test(sheets));
// The sheets file is hard-wrapped for reading, so allow the wrap.
ok('the animal entry requires the markers be visible',
   /Every physical marker listed below must be\s+visible/.test(sheets));
ok('the human entry gets no animal note', !/=== ILAN ===\s+\(human\)\s*\nThis is an ANIMAL/.test(sheets));
ok('the header warns against a multi-angle sheet', /Do not make a multi-angle sheet/.test(sheets));
ok('character_refs is created for a cast', fs.existsSync(path.join(mixedOut.dir, 'character_refs')));

const humanCast = W.normaliseCast(ghibli, [
    { name: 'Mira', description: 'Same Mira throughout - a young woman.', sheet_prompt: 'a woman' },
]);
const humanOut = writeInto('human', ghibli, humanCast);
const humanSheets = fs.readFileSync(path.join(humanOut.dir, 'character_sheets.txt'), 'utf8');
ok('a human-only cast gets no animal note', !/This is an ANIMAL/.test(humanSheets));
ok('a human-only cast gets no multi-angle warning', !/multi-angle/.test(humanSheets));
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
   mixedOut.story.character_references.rusty === './character_refs/rusty_reference_sheet.jpg');

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
