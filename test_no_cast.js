// Tests for the optional-cast path: a story whose topic needs no characters.
// Run: node test_no_cast.js     (no network)
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('./write_story.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
}

const sci = W.loadPreset('science-what-if');
const ghibli = W.loadPreset('ghibli');

console.log('\n--- the new preset is well formed ---');
ok('exists', !!sci);
ok('has an id and label', sci.id === 'science-what-if' && !!sci.label);
ok('cast is optional', sci.cast === 'optional');
ok('names no real studio or agency', !/studio|pixar|disney|ghibli|nasa|esa|imax/i.test(
    [sci.style, sci.whisk, sci.cast_idiom].join(' ')), sci.style);
ok('has story shapes', (sci.story_shapes || []).length >= 3);
ok('has a narration voice', !!sci.narration_voice);
ok('forbids naming real scientists', /no named real scientists/i.test(sci.avoid));
ok('forbids on-screen text', /no on-screen text/i.test(sci.avoid));

console.log('\n--- every preset declares its cast policy ---');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'styles.json'), 'utf8'));
const bad = db.styles.filter(p => p.cast !== 'required' && p.cast !== 'optional');
ok('all presets have a valid cast field', bad.length === 0, bad.map(p => p.id).join(', '));
ok('character genres are required', db.styles.find(p => p.id === 'ghibli').cast === 'required');
ok('explainer genres are optional', db.styles.find(p => p.id === 'technology-ai').cast === 'optional');
console.log(`       (${db.styles.filter(p => p.cast === 'required').length} required, ` +
            `${db.styles.filter(p => p.cast === 'optional').length} optional)`);

console.log('\n--- buildStory with no cast ---');
const scenesNoCast = [1, 2].map(i => ({
    scene_title: 'T' + i,
    script_line: 'The oceans slump toward the poles.',
    narrative_context: 'A vast shoreline at dusk.',
    characters: [],
}));
const noCast = W.buildStory(sci, [], { description: 'd', moral: 'm', target_audience: 'a' }, scenesNoCast);
ok('character_descriptions is empty', Object.keys(noCast.character_descriptions).length === 0);
ok('character_references is empty', Object.keys(noCast.character_references).length === 0);
ok('scenes still carry an empty characters array', noCast.scenes.every(s => Array.isArray(s.characters) && !s.characters.length));
ok('narration is still marked', noCast.narrated === true);
ok('narrator voice carried', !!noCast.narrator_voice);

console.log('\n--- validate accepts a no-cast story ---');
ok('no errors', W.validate(noCast, []).length === 0, JSON.stringify(W.validate(noCast, [])));

console.log('\n--- validate still rejects a phantom character ---');
const phantom = JSON.parse(JSON.stringify(noCast));
phantom.scenes[0].characters = ['mira'];
const errs = W.validate(phantom, []);
ok('a character not in the (empty) cast is rejected',
   errs.some(e => /mira/.test(e)), JSON.stringify(errs));

console.log('\n--- validate still requires characters when there IS a cast ---');
const withCast = W.buildStory(ghibli, [{ name: 'Mira', description: 'x' }],
    { description: 'd', moral: 'm' }, scenesNoCast);
const errs2 = W.validate(withCast, [{ name: 'Mira', description: 'x' }]);
ok('missing characters is still an error for a cast story',
   errs2.filter(e => /no characters listed/.test(e)).length === 2, JSON.stringify(errs2));

console.log('\n--- writePackage with no cast ---');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3_nocast_'));
const dir = path.join(tmp, 'science_test');
fs.mkdirSync(dir, { recursive: true });
const p1 = W.writePackage(dir, sci, noCast, []);
ok('story JSON written', fs.existsSync(p1));
ok('style bible written', fs.existsSync(path.join(dir, 'style_bible.md')));
ok('NOT character_sheets.txt', !fs.existsSync(path.join(dir, 'character_sheets.txt')));
ok('NOT character_refs/', !fs.existsSync(path.join(dir, 'character_refs')));

const bible = fs.readFileSync(path.join(dir, 'style_bible.md'), 'utf8');
ok('bible says there is no cast', /None\. This topic is about the world/.test(bible));
ok('bible skips the sheet step', /no reference sheets and no Characters/i.test(bible));
ok('bible has no empty ** entries', !/\*\* \*\*|\*\*\*\*/.test(bible));
ok('bible is not missing the look', bible.includes(sci.style));
const written = JSON.parse(fs.readFileSync(p1, 'utf8'));
ok('no _cast key leaked into the JSON', !Object.keys(written).some(k => k.startsWith('_')));
ok('JSON has empty character maps', Object.keys(written.character_descriptions).length === 0);

console.log('\n--- writePackage with a cast is unchanged ---');
const dir2 = path.join(tmp, 'ghibli_test');
fs.mkdirSync(dir2, { recursive: true });
W.writePackage(dir2, ghibli, withCast, [{ name: 'Mira', description: 'Same Mira throughout - x', sheet_prompt: 'sp' }]);
ok('character_sheets.txt written', fs.existsSync(path.join(dir2, 'character_sheets.txt')));
ok('character_refs/ created', fs.existsSync(path.join(dir2, 'character_refs')));
const bible2 = fs.readFileSync(path.join(dir2, 'style_bible.md'), 'utf8');
ok('bible lists the cast under a lower-case key', /\*\*mira\*\* - x/.test(bible2),
   bible2.split('\n').filter(l => l.startsWith('**')).join(' | '));
ok('bible keeps the sheet step', /Generate the sheets from `character_sheets.txt`/.test(bible2));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
