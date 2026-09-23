// Tests for mention_target.js - which tile the "@" picker should click.
//
// The fixtures are the REAL picker dumps saved by agent_mode.js into
// logs/agent_run_*/. That matters: the shapes here (a mat-list category rail, a
// cdk-virtual-scroll-viewport of asset tiles, an inner <span> holding just the
// name, an "Add to prompt" button) are Flow's actual DOM, not my idea of it.
//
// Run: node test_mention_target.js      (no browser, no network)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const M = require('./mention_target.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 200) : ''}`); }
}

function loadTree(run, file) {
    const p = path.join(__dirname, 'logs', run, file);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function tiles(tree) { return (tree && tree.clickable) || []; }

console.log('\n--- the real runs: what each picker offered ---');
const GOOD   = loadTree('agent_run_2026-09-12T18-40-11', '04_picker1-tree.json');  // EVELYN.jpg Image
const BAD    = loadTree('agent_run_2026-09-13T15-25-55', '04_picker1-tree.json');  // JULIAN Character
const BAHU   = loadTree('agent_run_2026-09-15T10-13-45', '04_picker1-tree.json');  // tara Character

if (!GOOD || !BAD || !BAHU) {
    console.log('  (some fixture runs are missing - the synthetic cases below still cover the rule)');
}

if (GOOD) {
    console.log('\n--- 2026-09-12, the run that was CONSISTENT ---');
    const c = M.chooseMentionTile(tiles(GOOD), 'EVELYN');
    ok('finds the asset tile', !!c.inner, JSON.stringify(c));
    ok('classifies it as a raw Image', c.kind === 'image', c.kind);
    const label = M.normText(c.inner.text || c.inner.aria);
    ok('clicks into the EVELYN.jpg tile', /evelyn/i.test(label), label);
    ok('does not click the category rail', !M.isNavCategory(label), label);
}

if (BAD) {
    console.log('\n--- 2026-09-13, the first run that DRIFTED ---');
    const c = M.chooseMentionTile(tiles(BAD), 'JULIAN');
    ok('still attaches something rather than failing', !!c.inner, JSON.stringify(c));
    ok('reports it as a Character tile', c.kind === 'character', c.kind);
    ok('the log line warns about drift',
       /drifts/.test(M.describeChoice(c, 'JULIAN')), M.describeChoice(c, 'JULIAN'));
    ok('skips the voice child (orus/achernar) that rides along with the Character',
       !/orus|achernar/i.test(M.normText(c.inner.text || c.inner.aria)));
    ok('skips the "Add to prompt" button',
       !/add to prompt/i.test(M.normText(c.inner.text || c.inner.aria)));
}

if (BAHU) {
    console.log('\n--- 2026-09-15, the Bahu run ---');
    const c = M.chooseMentionTile(tiles(BAHU), 'Tara');
    ok('finds the tile when the search is a different case than the asset',
       !!c.inner && /tara/i.test(M.normText(c.inner.text || c.inner.aria)),
       M.normText(c && c.inner && c.inner.text));
    ok('flags it as a Character', c.kind === 'character', c.kind);
}

// ---------------------------------------------------------------------------
// The regression this whole change exists for: when BOTH are offered, prefer
// the raw Image. This is the case the old depth-sort got wrong.
// ---------------------------------------------------------------------------
console.log('\n--- both offered: the Image must win ---');
// Shapes copied from the real dumps: an asset tile with a type suffix, plus an
// inner span holding just the name (deeper than the tile, as Flow renders it).
const both = [
    // Character tile - deliberately DEEPER, because DOM depth used to decide.
    { tag: 'div',    text: 'tara\nCharacter', aria: null, depth: 30, rect: { x: 700, y: 300, w: 180, h: 120 }, cx: 790, cy: 360 },
    { tag: 'button', text: 'tara\nCharacter', aria: null, depth: 31, rect: { x: 702, y: 302, w: 176, h: 116 }, cx: 790, cy: 360 },
    { tag: 'span',   text: 'tara',            aria: null, depth: 36, rect: { x: 760, y: 400, w: 40,  h: 16  }, cx: 780, cy: 408 },
    // Image tile - shallower, so the old code would have lost to the Character.
    { tag: 'div',    text: 'TARA.jpg\nImage', aria: null, depth: 20, rect: { x: 700, y: 120, w: 180, h: 120 }, cx: 790, cy: 180 },
    { tag: 'button', text: 'TARA.jpg\nImage', aria: null, depth: 21, rect: { x: 702, y: 122, w: 176, h: 116 }, cx: 790, cy: 180 },
    { tag: 'span',   text: 'TARA.jpg',        aria: null, depth: 26, rect: { x: 740, y: 220, w: 90,  h: 16  }, cx: 785, cy: 228 },
    // Noise that also contains the name.
    { tag: 'mat-list-item', text: 'accessibility_new\nCharacters', aria: null, depth: 11, rect: { x: 600, y: 218, w: 200, h: 38 }, cx: 700, cy: 237 },
    { tag: 'button', text: 'Add to prompt',   aria: null, depth: 13, rect: { x: 900, y: 400, w: 120, h: 36 }, cx: 960, cy: 418 },
];
const pick = M.chooseMentionTile(both, 'Tara');
ok('picks the Image, not the deeper Character', pick.kind === 'image', pick.kind);
ok('the click lands inside the Image tile', /TARA\.jpg/.test(M.normText(pick.inner.text)), M.normText(pick.inner.text));
ok('the click is inside the tile it ranked', M.chooseMentionTile(both, 'Tara').tile === pick.tile);
ok('the old rule would have picked the Character (proving this is a real change)', (() => {
    // Reproduce the OLD rule exactly: deepest node whose text matches the name.
    const old = both.filter(c => /tara/i.test(c.text)).sort((a, b) => b.depth - a.depth)[0];
    const charTile = both.find(c => M.tileKind(c.text) === 'character');
    const r = charTile.rect, o = old.rect;
    // It lands on the inner span of the Character tile, i.e. the drifting kind.
    return o.x >= r.x && o.y >= r.y && o.x + o.w <= r.x + r.w && o.y + o.h <= r.y + r.h;
})());

console.log('\n--- ordering when only non-Image kinds exist ---');
const kinds = [
    { tag: 'button', text: 'Nia\nVideo',     depth: 10, rect: { x: 0, y: 0, w: 100, h: 100 }, cx: 50, cy: 50 },
    { tag: 'button', text: 'Nia\nCharacter', depth: 20, rect: { x: 0, y: 0, w: 100, h: 100 }, cx: 50, cy: 50 },
    { tag: 'button', text: 'Nia\nAvatar',    depth: 30, rect: { x: 0, y: 0, w: 100, h: 100 }, cx: 50, cy: 50 },
];
ok('Character beats Video and Avatar', M.chooseMentionTile(kinds, 'Nia').kind === 'character',
   M.chooseMentionTile(kinds, 'Nia').kind);

// ---------------------------------------------------------------------------
// The 2026-09-16 run: fixtures taken from the tiles that run actually saw. The
// asset is named "elena", not "elena_reference_sheet.jpg", so every tile is
// extension-less. This is the same choice as the TARA.jpg case above, and it
// must come out the same way now that tileKind reads a bare "Image" suffix.
// ---------------------------------------------------------------------------
console.log('\n--- extension-less tiles (the 2026-09-16 run) ---');
const bare = [
    // As the run saw it: one Image tile, four nested nodes, deepest is the name.
    { tag: 'cdk-virtual-scroll-viewport', text: 'elena\nImage', depth: 12, rect: { x: 700, y: 100, w: 200, h: 400 }, cx: 800, cy: 300 },
    { tag: 'div',    text: 'elena\nImage', depth: 14, rect: { x: 700, y: 120, w: 180, h: 120 }, cx: 790, cy: 180 },
    { tag: 'button', text: 'elena\nImage', depth: 15, rect: { x: 702, y: 122, w: 176, h: 116 }, cx: 790, cy: 180 },
    { tag: 'div',    text: 'elena\nImage', depth: 17, rect: { x: 704, y: 124, w: 172, h: 112 }, cx: 790, cy: 180 },
    { tag: 'span',   text: 'elena',        depth: 18, rect: { x: 720, y: 200, w: 60,  h: 16  }, cx: 750, cy: 208 },
    { tag: 'mat-list-item', text: 'image\nImages', depth: 11, rect: { x: 582, y: 86, w: 120, h: 36 }, cx: 642, cy: 104 },
    { tag: 'button', text: 'Add to prompt', depth: 13, rect: { x: 900, y: 400, w: 120, h: 36 }, cx: 960, cy: 418 },
];
const barePick = M.chooseMentionTile(bare, 'elena');
ok('an extension-less Image tile is ranked, not shrugged at',
   barePick.kind === 'image', barePick.kind + '/' + barePick.reason);
ok('and it is not mistaken for the Images rail',
   M.isNavCategory('image\nImages') && barePick.tile.text.includes('Image'));
ok('the click lands in the tile, not the viewport around it',
   M.normText(barePick.inner.text) === 'elena');

// The case the fallback could not survive: a Character of the same name. With
// tileKind blind to "elena Image", nothing was ranked and the deepest node won
// - which is the Character's span, i.e. the drift bug back again.
const bareBoth = bare.concat([
    { tag: 'button', text: 'elena\nCharacter', depth: 21, rect: { x: 700, y: 600, w: 176, h: 116 }, cx: 790, cy: 658 },
    { tag: 'span',   text: 'elena',            depth: 26, rect: { x: 720, y: 660, w: 60,  h: 16  }, cx: 750, cy: 668 },
]);
ok('with a Character of the same name offered, the Image still wins',
   M.chooseMentionTile(bareBoth, 'elena').kind === 'image',
   M.chooseMentionTile(bareBoth, 'elena').kind);
ok('and the click is inside the Image tile, not the deeper Character',
   M.chooseMentionTile(bareBoth, 'elena').inner.rect.y < 600);

console.log('\n--- missing and edge cases ---');
ok('no match returns null rather than throwing', M.chooseMentionTile(both, 'Nobody').inner === null);
ok('an empty list returns null', M.chooseMentionTile([], 'Tara').inner === null);
ok('null candidates return null', M.chooseMentionTile(null, 'Tara').inner === null);
ok('a regex-special name is not treated as a pattern',
   M.chooseMentionTile([{ tag: 'button', text: 'A.B\nImage', depth: 5, rect: { x: 0, y: 0, w: 10, h: 10 }, cx: 5, cy: 5 }], 'A.B').inner !== null &&
   M.chooseMentionTile([{ tag: 'button', text: 'AXB\nImage', depth: 5, rect: { x: 0, y: 0, w: 10, h: 10 }, cx: 5, cy: 5 }], 'A.B').inner === null);
ok('a giant container that merely contains the name is ignored',
   M.chooseMentionTile([{ tag: 'div', text: 'x'.repeat(200) + ' Tara', depth: 99, rect: { x: 0, y: 0, w: 9, h: 9 }, cx: 1, cy: 1 }], 'Tara').inner === null);

console.log('\n--- classification ---');
ok('an image tile is an image', M.tileKind('EVELYN.jpg Image') === 'image');
// The name Flow shows is the asset's name as Flow knows it. An image the user
// uploaded by hand is named "elena", and the tile reads "elena Image" with no
// extension - requiring one classified it as unknown, which skipped the kind
// ranking entirely and fell back to the deepest node. That fallback happened to
// be right only because no Character of the same name existed to lose to.
ok('an image tile needs no file extension', M.tileKind('elena Image') === 'image');
ok('and the multi-line form the DOM actually returns works too',
   M.tileKind('elena\nImage') === 'image');
ok('the Images rail is still not an asset tile', !M.isNavCategory('elena Image'));
ok('a character tile is a character', M.tileKind('tara Character') === 'character');
ok('a video tile is a video', M.tileKind('Tara evicts Mrs Singhania Video') === 'video');
ok('the name alone has no kind', M.tileKind('tara') === null);
ok('"Charcoal" is not a Character', M.tileKind('Charcoal') === null);
ok('the Characters rail is navigation', M.isNavCategory('accessibility_new Characters'));
ok('the Images rail is navigation', M.isNavCategory('image Images'));
ok('an "Image" asset tile is NOT navigation', !M.isNavCategory('EVELYN.jpg Image'));
ok('a "Character" asset tile is NOT navigation', !M.isNavCategory('tara Character'));
ok('"Add to prompt" is an action', M.isAction('Add to prompt'));
ok('"Upload media" is an action', M.isAction('upload Upload media'));

// ---------------------------------------------------------------------------
// The reference sheets: the story JSON says `<key>_reference_sheet.jpg`, disk
// says `TARA.jpg`. Nothing resolved before this.
// ---------------------------------------------------------------------------
console.log('\n--- reference sheet lookup ---');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refs-'));
fs.mkdirSync(path.join(dir, 'character_refs'));
fs.writeFileSync(path.join(dir, 'character_refs', 'TARA.jpg'), 'x');
fs.writeFileSync(path.join(dir, 'character_refs', 'SINGHANIA.jpg'), 'x');
fs.writeFileSync(path.join(dir, 'character_refs', 'tara_old_backup.png'), 'x');

// New convention: the JSON says `./character_refs/tara.jpg`, and that (or the
// same basename with another image extension) is what is on disk.
const refs = { tara: './character_refs/tara.jpg',
               singhania: './character_refs/singhania.jpg' };
ok('the simple name resolves directly',
   /tara\.jpg$/i.test(M.resolveCharacterRef(refs, 'tara', dir) || ''),
   M.resolveCharacterRef(refs, 'tara', dir));
// Old stories declare `<key>_reference_sheet.jpg` while the file on disk is
// TARA.jpg; the basename search still has to find it.
const legacyRefs = { tara: './character_refs/tara_reference_sheet.jpg',
                     singhania: './character_refs/singhania_reference_sheet.jpg' };
ok('finds TARA.jpg from the stale declared name',
   /TARA\.jpg$/.test(M.resolveCharacterRef(legacyRefs, 'tara', dir) || ''),
   M.resolveCharacterRef(legacyRefs, 'tara', dir));
ok('finds SINGHANIA.jpg too',
   /SINGHANIA\.jpg$/.test(M.resolveCharacterRef(legacyRefs, 'singhania', dir) || ''));
ok('an exact basename beats a prefix match',
   /TARA\.jpg$/.test(M.resolveCharacterRef(legacyRefs, 'TARA', dir) || ''), 'must not pick tara_old_backup.png');
ok('works when the JSON declares nothing at all',
   /TARA\.jpg$/.test(M.resolveCharacterRef({}, 'tara', dir) || ''));
ok('an unknown character resolves to null', M.resolveCharacterRef(refs, 'nobody', dir) === null);
ok('a missing folder resolves to null, not a throw',
   M.resolveCharacterRef(refs, 'tara', path.join(dir, 'nope')) === null);
ok('a declared path that exists is used as-is', (() => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'refs2-'));
    fs.mkdirSync(path.join(d2, 'character_refs'));
    fs.writeFileSync(path.join(d2, 'character_refs', 'proper_sheet.jpg'), 'x');
    return /proper_sheet\.jpg$/.test(M.resolveCharacterRef(
        { tara: './character_refs/proper_sheet.jpg' }, 'tara', d2) || '');
})());

fs.rmSync(dir, { recursive: true, force: true });

console.log('\n--- one chip per reference, however often the prompt names it ---');
// The real agent prompt for a two-hander names the place three times: once in
// the PLACE section, once in the reminder line and once per scene. Every "@"
// used to become its own trip through the picker - the same tile clicked three
// times, five chips for three references.
const PROSE = ['Bedroom', 'Godwin', 'Tari', 'Bedroom', 'Bedroom'];
ok('five "@" names become three chips',
   M.distinctMentions(PROSE).length === 3, M.distinctMentions(PROSE));
ok('they keep the order the prompt reads in',
   JSON.stringify(M.distinctMentions(PROSE)) === JSON.stringify(['Bedroom', 'Godwin', 'Tari']),
   M.distinctMentions(PROSE));
ok('a repeated name is dropped, not the first one', M.distinctMentions(['a', 'b', 'a'])[0] === 'a');
ok('casing does not make a second chip', M.distinctMentions(['Tara', 'tara', 'TARA']).length === 1,
   M.distinctMentions(['Tara', 'tara', 'TARA']));
ok('the first spelling wins', M.distinctMentions(['TARA', 'tara'])[0] === 'TARA');
ok('--mention "Mia,Mia,Jon" attaches two', M.distinctMentions(['Mia', 'Mia', 'Jon']).length === 2);
ok('blanks and stray spaces are not chips',
   JSON.stringify(M.distinctMentions([' Mia ', '', '  ', null, undefined, 'Jon'])) ===
   JSON.stringify(['Mia', 'Jon']), M.distinctMentions([' Mia ', '', '  ', null, undefined, 'Jon']));
ok('an empty prompt means no chips', M.distinctMentions([]).length === 0);
ok('a prompt with no "@" at all is safe', M.distinctMentions(undefined).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
