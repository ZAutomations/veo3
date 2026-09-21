// Tests for the CAST block in the agent prompt.
//
// The story JSON has always carried `character_descriptions`, and this converter
// has always dropped it - so the prompt named the cast and asked for consistency
// without ever saying what either of them looks like. A two-hander came back with
// a different woman every clip, and one clip recast her as a different ethnicity.
//
// Run: node test_cast_identity.js     (no network)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 160) : ''}`); }
}

const CONV = path.join(__dirname, 'story_to_agent_prompt.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-id-'));

function convert(story, name) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(story, null, 2) + '\n', 'utf8');
    return execFileSync(process.execPath, [CONV, p, '--print'], { encoding: 'utf8' });
}

const TARA = 'Same Tara throughout - low neat bun, muted sage green embroidered silk saree.';
const SINGH = 'Same Singhania throughout - graying hair in an elaborate hairpiece, dusty rose saree.';

const base = (over = {}) => ({
    title: 'T', description: 'd', moral: 'm', style: 'manhwa', aspect_ratio: '9:16',
    scene_seconds: 8, narrated: false, narration_scope: 'dialogue',
    character_descriptions: { tara: TARA, singhania: SINGH },
    scenes: [
        { _scene_number: 1, _scene_title: 'One', characters: ['tara', 'singhania'],
          dialogue: [{ speaker: 'Tara', line: 'a' }], narrative_context: 'A room.' },
        { _scene_number: 2, _scene_title: 'Two', characters: ['tara'],
          dialogue: [{ speaker: 'Tara', line: 'b' }], narrative_context: 'A room.' },
    ],
    ...over,
});

console.log('\n--- the cast is described, not just named ---');
const withCast = convert(base(), 'with_cast.json');
ok('emits a CAST block', /CAST - FIXED APPEARANCE/.test(withCast));
ok('carries Tara\'s description', withCast.includes(TARA));
ok('carries Singhania\'s description', withCast.includes(SINGH));
ok('capitalises the names the block prints', /^\s{2}Tara: Same Tara/m.test(withCast), withCast.slice(0, 400));
ok('reads the lower-case JSON keys', !/^\s{2}tara:/m.test(withCast));
ok('still builds the mention list', /using @Tara and @Singhania/.test(withCast));

console.log('\n--- every scene repeats what its own cast looks like ---');
const sceneBlocks = withCast.split(/^Scene \d+/m).slice(1);
ok('there is one scene block per scene', sceneBlocks.length === 2, sceneBlocks.length);
ok('scene 1 describes both', sceneBlocks[0].includes(TARA) && sceneBlocks[0].includes(SINGH));
ok('scene 2, which is Tara alone, describes only Tara',
   sceneBlocks[1].includes(TARA) && !sceneBlocks[1].includes(SINGH));
ok('the repeat says what it is for', /identical to the CAST block and to every other clip/.test(sceneBlocks[0]));
ok('and forbids restyling', /Do not restyle, do not recast/.test(sceneBlocks[0]));
// The identity has to sit above the VISUAL line, or a long scene brief that gets
// trimmed takes the face description with it.
ok('the identity comes before the scene VISUAL',
   sceneBlocks[0].indexOf(TARA) < sceneBlocks[0].indexOf('VISUAL:'), 'order matters');
ok('the identity comes before the DIALOGUE too',
   sceneBlocks[0].indexOf(TARA) < sceneBlocks[0].indexOf('DIALOGUE'), 'order matters');

console.log('\n--- a story with no descriptions still converts ---');
const bare = base({ character_descriptions: {} });
delete bare.character_descriptions;
const noDesc = convert(bare, 'no_desc.json');
ok('no CAST block', !/CAST - FIXED APPEARANCE/.test(noDesc));
ok('no per-scene identity', !/CHARACTERS IN THIS CLIP/.test(noDesc));
ok('the scenes still come through', /Scene 1/.test(noDesc) && /Scene 2/.test(noDesc));
ok('the mentions still come through', /using @Tara and @Singhania/.test(noDesc));
ok('warns that the cast will drift', /character_descriptions/.test(noDesc));
// The warning is on stderr's side of the summary, which --print does not emit;
// so make the same point by running without --print and reading stdout.
const warnOut = execFileSync(process.execPath, [CONV, path.join(dir, 'no_desc.json')], { encoding: 'utf8' });
ok('the warning names the count', /never says what the cast looks like/.test(warnOut), warnOut.slice(-400));

console.log('\n--- a partly described cast is called out ---');
const half = base({ character_descriptions: { tara: TARA } });
const halfOut = convert(half, 'half.json');
ok('the described one is printed', halfOut.includes(TARA));
ok('the undescribed one is not invented', !/Singhania: /.test(halfOut));
ok('a partial-cast warning is emitted',
   /1 character\(s\) have no/.test(execFileSync(process.execPath, [CONV, path.join(dir, 'half.json')], { encoding: 'utf8' })));

console.log('\n--- a no-cast story is untouched ---');
const noCast = base({ character_descriptions: {}, scenes: [
    { _scene_number: 1, script_line: 'The sea.', narrative_context: 'Waves.' },
] });
delete noCast.character_descriptions;
const ncOut = convert(noCast, 'no_cast.json');
ok('no CAST block for a story with no people', !/CAST - FIXED APPEARANCE/.test(ncOut));
ok('keeps the no-people closing rule', /NO characters and no reference images/.test(ncOut));
ok('emits no mention list', !/using @/.test(ncOut));

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
