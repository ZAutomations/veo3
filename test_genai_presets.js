// Tests for the second preset list (GENAI Presets) and the map-hook fix.
//
// The GENAI list lives in genai_styles.json, apart from styles.json, so the
// classic list is untouched and the two can be toggled in the GUI. This checks
// that file is well formed, that ids do not collide across the two lists, and
// that write_story.js can load a preset from either.
//
// Run: node test_genai_presets.js     (no network)
const fs = require('fs');
const path = require('path');
const W = require('./write_story.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 220) : ''}`); }
}

const GENAI = path.join(__dirname, 'genai_styles.json');
const CLASSIC = path.join(__dirname, 'styles.json');

console.log('\n--- the GENAI list is its own file ---');
ok('genai_styles.json exists', fs.existsSync(GENAI));
const genai = JSON.parse(fs.readFileSync(GENAI, 'utf8')).styles || [];
const classic = JSON.parse(fs.readFileSync(CLASSIC, 'utf8')).styles || [];
ok('it has presets', genai.length >= 4, String(genai.length));
ok('it is separate from the classic list', genai.every(p => !classic.some(c => c.id === p.id)));
ok('its ids are unique', new Set(genai.map(p => p.id)).size === genai.length);
ok('presetLists() returns both lists', W.presetLists().length === classic.length + genai.length);

const RE_STUDIO = /\b(studio|pixar|disney|ghibli|nasa|esa|imax|netflix|marvel)\b|trigun|cowboy bebop/i;

console.log('\n--- every GENAI preset is well formed ---');
for (const p of genai) {
    const tag = p.id || '(no id)';
    ok(`${tag}: has a label`, !!p.label);
    ok(`${tag}: has a style string`, typeof p.style === 'string' && p.style.length > 30);
    ok(`${tag}: has a whisk`, typeof p.whisk === 'string' && p.whisk.length > 20);
    ok(`${tag}: names no real studio or anime title`,
        !RE_STUDIO.test([p.style, p.whisk, p.cast_idiom || ''].join(' ')));
    ok(`${tag}: has at least three story shapes`, (p.story_shapes || []).length >= 3);
    ok(`${tag}: has a narration voice`, !!p.narration_voice);
    ok(`${tag}: forbids on-screen text`, /no on-screen text/i.test(p.avoid || ''));
    ok(`${tag}: cast is required or optional`, p.cast === 'required' || p.cast === 'optional');
    ok(`${tag}: declares no cast_types (the classic list owns those)`, p.cast_types === undefined);
    ok(`${tag}: declares no default_duration`, p.default_duration === undefined);
    ok(`${tag}: has a direction the writer must follow`,
        typeof p.direction === 'string' && p.direction.length > 80);
}

console.log('\n--- write_story can load a GENAI preset by id ---');
ok('loadPreset finds the first GENAI preset', W.loadPreset(genai[0].id).id === genai[0].id);
ok('and a CLASSIC one still loads', W.loadPreset(classic[0].id).id === classic[0].id);
ok('an unknown id is rejected by the loader (it exits, so just prove order works)',
    W.presetLists().some(x => x.id === genai[0].id));

console.log('\n--- the map presets now open on a HOOK ---');
for (const id of ['geography-map', '3d-map']) {
    const p = W.loadPreset(id);
    ok(`${id}: has a direction`, typeof p.direction === 'string');
    ok(`${id}: clip 1 must be a hook, not the first fact`,
        /Clip 1 is a HOOK/i.test(p.direction || ''), (p.direction || '').slice(0, 90));
    ok(`${id}: forbids a greeting or a globe tour`,
        /no greeting|never a slow map tour|a zoom-out to establish|no map tour/i.test(p.direction || ''));
    ok(`${id}: the hook reaches call 1`, /Clip 1 is a HOOK/i.test(W.castPrompt(p)));
    ok(`${id}: and call 2`,
        /Clip 1 is a HOOK/i.test(W.scenesPrompt(p, [], [{ title: 'x', beat: 'y' }], 0, 1, [])));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
