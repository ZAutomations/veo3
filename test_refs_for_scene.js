// Tests for refs_for_scene.js - which reference images a scene needs, and how
// the engine tells whether they actually attached.
//
// The two failures this pins down, both measured on
// stories/the_price_of_obligation:
//
//   * the PLACE is in refs.json (kind "place") and in character_sheets.txt, but
//     NOT in the story's character_references - the map the engine used to
//     iterate - so the bedroom plate was never attached to any clip;
//   * character_refs/ is EMPTY, so the two paths the story records resolved to
//     nothing while the run logged a warning and carried on.
//
// Plus the one this is really here for: an attachment is only real when it is
// READ BACK off the prompt box. Prose naming a character is not an attachment.
//
// Run: node test_refs_for_scene.js     (no network, no Flow, no credits)
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./refs_for_scene.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-refs-'));
const mk = (rel, content) => {
    const p = path.join(TMP, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return p;
};

console.log('\n--- comparing two spellings of the same name ---');
ok('case and punctuation collapse', R.refKey('Godwin') === R.refKey('godwin') && R.refKey('Godwin') === 'godwin');
ok('underscores and spaces collapse too', R.refKey('godwin_reference sheet') === 'godwinreferencesheet');
ok('a filename and its stem differ', R.refKey('godwin.jpg') === 'godwinjpg');
ok('nothing is an empty key', R.refKey(null) === '' && R.refKey(undefined) === '');
ok('character vs place is read off kind', R.isPlace({ kind: 'place' }) && !R.isPlace({ kind: 'character' }));
ok('a missing kind is a character, not a place', !R.isPlace({ name: 'Godwin' }));

console.log('\n--- reading the refs a story declares ---');
// The real shape of stories/the_price_of_obligation/refs.json.
const REFS_JSON = JSON.stringify({
    refs: [
        { name: 'Godwin', file: 'godwin.jpg', kind: 'character', prompt: 'A sheet of Godwin.' },
        { name: 'Tari', file: 'tari.jpg', kind: 'character', prompt: 'A sheet of Tari.' },
        { name: 'Bedroom', file: 'Bedroom.jpg', kind: 'place', prompt: 'An empty bedroom.' },
    ],
});
const rf = mk('a/refs.json', REFS_JSON);
const three = R.readRefsFile(rf);
ok('every declared ref is read', three.length === 3, String(three.length));
ok('the place is among them', three.some(r => r.kind === 'place' && r.name === 'Bedroom'));
ok('the cast is marked as cast', three.filter(r => r.kind === 'character').map(r => r.name).join(',') === 'Godwin,Tari');
ok('a bare array is accepted as well', (() => {
    const f = mk('a/bare.json', JSON.stringify([{ name: 'X', prompt: 'p' }]));
    return R.readRefsFile(f).length === 1;
})());
ok('a ref with no prompt is dropped - it cannot be generated',
   R.readRefsFile(mk('a/noprompt.json', JSON.stringify({ refs: [{ name: 'X' }, { name: 'Y', prompt: 'p' }] }))).length === 1);

// The real shape of character_sheets.txt: "=== PLACE - BEDROOM ===", and the
// prompt on the line after "-- image prompt --".
const SHEETS = [
    'Reference sheets for "A Film" - the cast and the place',
    '',
    '=== GODWIN ===   (human)',
    'save as: character_refs/godwin.jpg',
    '',
    '-- image prompt --',
    'A photorealistic character reference sheet of Godwin.',
    '',
    '=== PLACE - BEDROOM ===',
    'save as: character_refs/Bedroom.jpg',
    '',
    '-- image prompt --',
    'A photorealistic, empty, dimly lit contemporary bedroom.',
].join('\n');
const sheets = R.parseSheetsTxt(SHEETS);
ok('a sheets file yields every entry', sheets.length === 2, String(sheets.length));
ok('the "(human)" marker is stripped from the name', sheets[0].name === 'GODWIN', sheets[0].name);
ok('a PLACE heading is a place, and its name is the part after the dash',
   sheets[1].kind === 'place' && R.refKey(sheets[1].name) === 'bedroom', `${sheets[1].kind}/${sheets[1].name}`);
ok('the sheets place and a refs.json place agree on one key',
   R.refKey(sheets[1].name) === R.refKey('Bedroom'));
ok('the prompt is the line after the marker', /empty, dimly lit/.test(sheets[1].prompt));
ok('the save-as path is kept', sheets[0].file === 'character_refs/godwin.jpg', sheets[0].file);
ok('a file with no entries is an empty list', R.parseSheetsTxt('nothing here').length === 0);

console.log('\n--- which source wins ---');
const D1 = path.join(TMP, 'withrefs');
mk('withrefs/refs.json', REFS_JSON);
mk('withrefs/character_sheets.txt', SHEETS);
const s1 = R.loadStoryRefs(path.join(D1, 'film_story.json'), {});
ok('refs.json wins when it exists', s1.source === 'refs.json' && s1.refs.length === 3, s1.source);

const D2 = path.join(TMP, 'withsheets');
mk('withsheets/character_sheets.txt', SHEETS);
const s2 = R.loadStoryRefs(path.join(D2, 'film_story.json'), {});
ok('the sheets file is the fallback', s2.source === 'character_sheets.txt' && s2.refs.length === 2, s2.source);
ok('and it still brings the place', s2.refs.some(r => r.kind === 'place'));

const D3 = path.join(TMP, 'withneither');
fs.mkdirSync(D3, { recursive: true });
const s3 = R.loadStoryRefs(path.join(D3, 'film_story.json'),
    { character_references: { godwin: './character_refs/godwin.jpg', tari: './character_refs/tari.jpg' } });
ok('the story map is the last resort', s3.refs.length === 2 && /character_references/.test(s3.source), s3.source);
// THE POINT. This is the source that lost the place, and it says so.
ok('the fallback admits it has no place', /no place/.test(s3.source), s3.source);
ok('everything from the map is a character', s3.refs.every(r => r.kind === 'character'));
ok('an empty story declares nothing', R.loadStoryRefs(path.join(D3, 'x.json'), {}).refs.length === 0);

console.log('\n--- matching a ref to the tile on screen ---');
const godwin = three.find(r => r.name === 'Godwin');
const MAP = { godwin: './character_refs/godwin.jpg', tari: './character_refs/tari.jpg' };
const al = R.refAliases(godwin, MAP);
ok('the ref\'s own name is a candidate', al.includes('Godwin'));
ok('the saved file is a candidate too', al.some(a => R.refKey(a) === 'godwin') && al.some(a => R.refKey(a) === 'godwinjpg'), al.join('|'));
// Spellings are deduplicated on their KEY, so "Godwin" and "godwin" are one
// entry - the story map's key is reachable, just not as a second string.
ok('the story map\'s key is reachable, without a duplicate spelling',
   al.filter(a => R.refKey(a) === 'godwin').length === 1, al.join('|'));
ok('no spelling is repeated by key', new Set(al.map(R.refKey)).size === al.length, al.join('|'));
ok('an alias list for a ref with no file still has its name',
   R.refAliases({ name: 'Bedroom' }, {}).join(',') === 'Bedroom');
// A ref declared without a file is only reachable through the story's map,
// which names the sheet it was saved as.
ok('a ref with no file picks up the map\'s sheet name', (() => {
    const a = R.refAliases({ name: 'Tari' }, { tari: './character_refs/tari_sheet.jpg' });
    return a.some(x => R.refKey(x) === 'tarisheet');
})(), R.refAliases({ name: 'Tari' }, { tari: './character_refs/tari_sheet.jpg' }).join('|'));

console.log('\n--- what a scene needs ---');
const scene = { _scene_number: 1, characters: ['godwin', 'tari'] };
const need = R.refsForScene(scene, three, MAP);
ok('both characters are wanted', need.names.includes('Godwin') && need.names.includes('Tari'), need.names.join(','));
ok('AND the place - the whole point', need.names.includes('Bedroom'), need.names.join(','));
ok('the cast comes before the place', need.names.join(',') === 'Godwin,Tari,Bedroom', need.names.join(','));
ok('nothing the scene named is missing', need.missingCast.length === 0);
ok('three refs is exactly the cap, not over it', need.overCap === false);
ok('the cap is three', R.MAX_INGREDIENTS === 3);

const one = R.refsForScene({ characters: ['godwin'] }, three, MAP);
ok('a scene that names one character is not given the other',
   one.names.join(',') === 'Godwin,Bedroom', one.names.join(','));
const none = R.refsForScene({}, three, MAP);
ok('a scene naming nobody gets the whole cast', none.names.join(',') === 'Godwin,Tari,Bedroom', none.names.join(','));
const ghost = R.refsForScene({ characters: ['godwin', 'maya'] }, three, MAP);
ok('a character with no ref is reported, not invented',
   ghost.missingCast.join(',') === 'maya', ghost.missingCast.join(','));
ok('and the scene still gets what does exist', ghost.names.includes('Godwin') && ghost.names.includes('Bedroom'));
const four = R.refsForScene({ characters: ['godwin', 'tari'] },
    three.concat([{ name: 'Kitchen', kind: 'place', prompt: 'p' }]), MAP);
ok('a fourth ref is flagged as over the cap', four.overCap === true && four.refs.length === 4);

console.log('\n--- did it actually attach? ---');
const box = (text, chips) => ({ text, chips });
ok('an @mention counts', R.refLanded(godwin, box('@Godwin looks up.', []), MAP));
ok('the file-name spelling counts too', R.refLanded(godwin, box('@godwin_reference_sheet looks up.', []), MAP));
// THE POINT. The prompt box is full of prose naming the characters; none of it
// is an attachment.
ok('prose naming the character is NOT an attachment',
   R.refLanded(godwin, box('Godwin sits on the edge of the plush bed, facing Tari.', []), MAP) === false);
ok('an @mention of someone else does not count',
   R.refLanded(godwin, box('@Tari sits down.', []), MAP) === false);
ok('a chip element counts even with no @ in its text',
   R.refLanded(godwin, box('Godwin looks up.', ['Godwin']), MAP));
ok('another chips text does not satisfy it',
   R.refLanded(godwin, box('', ['Tari']), MAP) === false);
ok('an empty box attaches nothing', R.refLanded(godwin, box('', []), MAP) === false);
ok('a missing box is not a crash', R.refLanded(godwin, undefined, MAP) === false);

const partial = box('@Godwin looks up. Godwin is tense.', ['Godwin']);
const miss = R.missingRefs(need.refs, partial, MAP).map(r => r.name);
// The measured failure: one of the two characters landed and the run went on.
ok('the character that did not land is reported missing', miss.includes('Tari'), miss.join(','));
ok('and so is the place', miss.includes('Bedroom'), miss.join(','));
ok('the one that did land is not', !miss.includes('Godwin'));
ok('nothing is missing once all three are in',
   R.missingRefs(need.refs, box('@Godwin @Tari @Bedroom', []), MAP).length === 0);

console.log('\n--- against the real story on disk ---');
const STORY_DIR = path.join(__dirname, 'stories', 'the_price_of_obligation');
if (fs.existsSync(path.join(STORY_DIR, 'refs.json'))) {
    const story = JSON.parse(fs.readFileSync(path.join(STORY_DIR, 'the_price_of_obligation_story.json'), 'utf8'));
    const real = R.loadStoryRefs(path.join(STORY_DIR, 'the_price_of_obligation_story.json'), story);
    ok('the real story loads its refs from refs.json', real.source === 'refs.json', real.source);
    ok('all three real refs are read', real.refs.length === 3, real.refs.map(r => r.name).join(','));
    const map = story.character_references || {};
    ok('the real story map has no place in it - hence this module',
       !Object.keys(map).some(k => /bed|room|place/i.test(k)), Object.keys(map).join(','));
    const real1 = R.refsForScene(story.scenes[0], real.refs, map);
    ok('scene 1 now asks for both characters', real1.names.includes('Godwin') && real1.names.includes('Tari'), real1.names.join(','));
    // The measured bug: the place was never attached, so every clip re-invented
    // the room. This is the assertion that says it is fixed.
    ok('scene 1 now asks for the place as well', real1.names.includes('Bedroom'), real1.names.join(','));
    ok('scene 1 stays within the model\'s 3-image ceiling', real1.overCap === false);
    ok('an extend scene asks for the same three',
       R.refsForScene(story.scenes[1], real.refs, map).names.join(',') === real1.names.join(','),
       R.refsForScene(story.scenes[1], real.refs, map).names.join(','));
    // The story points at files that are not there; the module must still name
    // the refs, because the tiles are made in the project, not read from disk.
    ok('the refs resolve even though character_refs/ is empty',
       !fs.readdirSync(path.join(STORY_DIR, 'character_refs')).length && real.refs.length === 3);
    ok('the sheets file names the same place as refs.json', (() => {
        const sh = R.parseSheetsTxt(fs.readFileSync(path.join(STORY_DIR, 'character_sheets.txt'), 'utf8'));
        return sh.some(r => r.kind === 'place' && R.refKey(r.name) === 'bedroom');
    })());
} else {
    ok('the real story is on disk to test against', false, STORY_DIR);
}

console.log('\n--- the engine and the ref generator use it ---');
const engine = fs.readFileSync(path.join(__dirname, 'veo3_flow_new_ui.js'), 'utf8');
ok('the engine loads the refs from the story', /loadStoryRefs\(/.test(engine));
ok('the engine asks for a scene\'s refs through this module', /refsForScene\(/.test(engine));
ok('the engine reads back what attached', /missingRefs\(/.test(engine));
ok('the engine no longer decides refs from character_references alone',
   !/const names = \(scene\.characters && scene\.characters\.length\)\s*\n\s*\?\s*scene\.characters\s*\n\s*:\s*Object\.keys\(this\.characterReferences\)/.test(engine));
const gen = fs.readFileSync(path.join(__dirname, 'generate_refs.js'), 'utf8');
ok('the ref generator reads refs the same way', /loadStoryRefs\(|require\('\.\/refs_for_scene/.test(gen));
ok('the generator\'s own sheets parser is gone, not duplicated',
   !/function parseSheetsTxt/.test(gen));

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
