// Tests for the export-download fixes in veo3_flow_new_ui.js.
//
// WHY THIS EXISTS. Flow's "Download scene" is an ordinary browser download, and
// what it produces is not what the engine assumed. Measured from a real 5-clip
// export of stories/the_price_of_obligation:
//
//   ~/Downloads/Untitled Scene 09-23 10_04_54/_root___context___/
//       context___instruction___prompt_Continue_20260923151928.mp4
//       context___instruction___prompt_Continue_20260923151928_2.mp4
//       context___instruction___prompt_Continue_20260923151928_3.mp4
//       context___instruction___prompt_Continue_20260923151929.mp4
//       context___instruction___prompt_[SHOT]_20260923151956.mp4
//
// Two facts follow, and both are pinned here:
//
//   1. The files are TWO DIRECTORIES below ~/Downloads, one file per clip. The
//      engine read only the top level, for a single .mp4, so it saw none of
//      them and waited out its ten minutes - while, on this machine, seven
//      unrelated top-level .mp4 files sat there ready to be mistaken for the
//      export. mp4sUnder() sweeps recursively instead.
//
//   2. Their names carry Flow's WRITE order, and that is not story order. On
//      that export the establishing clip - the only one whose prompt starts
//      "[SHOT]" - was written LAST, and the four extends came back 2,5,3,4.
//      flowClipOrder() is deterministic but deliberately NOT presented as the
//      story order; see collectPerClipExport(), which gets the real order from
//      the dialogue with order_clips_by_dialogue.js.
//
// Run: node test_export_download.js     (no network, no Flow, no credits)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mp4sUnder, flowClipKey, flowClipOrder } = require('./veo3_flow_new_ui.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-dl-'));
const touch = (rel, bytes = 8) => {
    const p = path.join(TMP, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(bytes, 1));
    return p;
};

console.log('\n--- finding the export, however deep it is ---');
// The real shape: a project folder, then _root___context___, then the clips.
const A = touch('Untitled Scene 09-23 10_04_54/_root___context___/context___instruction___prompt_Continue_20260923151928.mp4');
const B = touch('Untitled Scene 09-23 10_04_54/_root___context___/context___instruction___prompt_Continue_20260923151928_2.mp4');
const C = touch('Untitled Scene 09-23 10_04_54/_root___context___/context___instruction___prompt_[SHOT]_20260923151956.mp4');
touch('Unrelated Video.mp4');                       // top level: the OLD code saw only these
touch('notes.txt');
touch('half-done.mp4.crdownload');                  // a partial must never be picked up

const found = mp4sUnder(TMP).map(x => path.basename(x.file));
ok('all three nested clips are found', [A, B, C].every(p => found.includes(path.basename(p))), found.join(','));
ok('a top-level .mp4 is found too', found.includes('Unrelated Video.mp4'));
ok('non-mp4 files are ignored', !found.some(f => /\.txt$/.test(f)));
ok('a partial download is never returned', !found.some(f => /crdownload/.test(f)));
ok('sizes come back with the files', mp4sUnder(TMP).every(x => typeof x.size === 'number'));
ok('the result is deterministic', (() => {
    const a = mp4sUnder(TMP).map(x => x.file).join('|');
    const b = mp4sUnder(TMP).map(x => x.file).join('|');
    return a === b;
})());
ok('a folder that does not exist is empty, not a crash', mp4sUnder(path.join(TMP, 'nope')).length === 0);
ok('a depth of one is enough for a plain folder', (() => {
    const D = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-flat-'));
    fs.writeFileSync(path.join(D, 'a.mp4'), 'x');
    const r = mp4sUnder(D).length === 1;
    fs.rmSync(D, { recursive: true, force: true });
    return r;
})());

console.log('\n--- reading a Flow clip name ---');
const K = (n) => flowClipKey(path.join(TMP, n));
ok('the first of a set: stem, stamp, seq 1', (() => {
    const k = K('context___instruction___prompt_Continue_20260923151928.mp4');
    return k.stem === 'context___instruction___prompt_Continue' && k.stamp === 20260923151928 && k.seq === 1;
})(), JSON.stringify(K('context___instruction___prompt_Continue_20260923151928.mp4')));
ok('the numbered ones keep the same stem', (() => {
    const k = K('context___instruction___prompt_Continue_20260923151928_2.mp4');
    return k.stem === 'context___instruction___prompt_Continue' && k.stamp === 20260923151928 && k.seq === 2;
})(), JSON.stringify(K('context___instruction___prompt_Continue_20260923151928_2.mp4')));
ok('a different prompt opening is a different stem', (() => {
    const k = K('context___instruction___prompt_[SHOT]_20260923151956.mp4');
    return k.stem === 'context___instruction___prompt_[SHOT]' && k.stamp === 20260923151956;
})(), JSON.stringify(K('context___instruction___prompt_[SHOT]_20260923151956.mp4')));
ok('a name with no Flow stamp still parses', (() => {
    const k = K('Some Clip.mp4');
    return k.stem === 'Some Clip' && k.stamp === 0 && k.seq === 1;
})(), JSON.stringify(K('Some Clip.mp4')));

console.log('\n--- ordering the names, deterministically ---');
const dir = path.join(TMP, 'Untitled Scene 09-23 10_04_54/_root___context___');
const real = [
    'context___instruction___prompt_Continue_20260923151928.mp4',
    'context___instruction___prompt_Continue_20260923151929.mp4',
    'context___instruction___prompt_Continue_20260923151928_2.mp4',
    'context___instruction___prompt_Continue_20260923151928_3.mp4',
    'context___instruction___prompt_[SHOT]_20260923151956.mp4',
].map(f => path.join(dir, f));
const ordered = real.slice().sort(flowClipOrder).map(f => path.basename(f));
const tag = (n) => n.replace(/^.*_prompt_/, '').replace(/\.mp4$/, '');
ok('the unnumbered clip comes before its numbered siblings', (() => {
    const i = ordered.findIndex(n => tag(n) === 'Continue_20260923151928');
    const j = ordered.findIndex(n => tag(n) === 'Continue_20260923151928_2');
    const k = ordered.findIndex(n => tag(n) === 'Continue_20260923151928_3');
    return i < j && j < k;
})(), ordered.map(tag).join(', '));
ok('an earlier stamp comes before a later one', (() => {
    return ordered.findIndex(n => tag(n) === 'Continue_20260923151928_3')
         < ordered.findIndex(n => tag(n) === 'Continue_20260923151929');
})(), ordered.map(tag).join(', '));
// THE POINT. This is the measured trap: the establishing clip is written last,
// so the name order is NOT story order. If this ever starts passing as story
// order, the comment in collectPerClipExport needs revisiting.
ok('the establishing clip sorts LAST, not first - so names are not story order',
   tag(ordered[ordered.length - 1]) === '[SHOT]_20260923151956', ordered.map(tag).join(', '));
ok('every clip survives the sort', ordered.length === real.length && new Set(ordered).size === real.length);
ok('the sort is a stable total order', (() => {
    const a = real.slice().sort(flowClipOrder).map(f => path.basename(f)).join('|');
    const b = real.slice().reverse().sort(flowClipOrder).map(f => path.basename(f)).join('|');
    return a === b;
})(), `${ordered.map(tag).join(',')}`);

console.log('\n--- the engine is wired to both ---');
const engine = fs.readFileSync(path.join(__dirname, 'veo3_flow_new_ui.js'), 'utf8');
ok('the export waits on the recursive sweep, not a flat readdir',
   /sweepRoots\.flatMap\(d => mp4sUnder\(d\)\)/.test(engine));
ok('the browser is told where to download', /setDownloadDir/.test(engine)
   && /Browser\.setDownloadBehavior/.test(engine));
ok('the download folder lives with the story', /this\.downloadDir = path\.join\(jsonDir, 'downloads'\)/.test(engine));
ok('a single file still goes through the ffmpeg split',
   /ex\.files\.length === 1[\s\S]{0,80}splitIntoScenes/.test(engine));
ok('several files go through the per-clip collection',
   /collectPerClipExport\(ex\.files\)/.test(engine));
ok('the per-clip order is taken from the dialogue, not from the names',
   /orderClipsByEar\(scratch\)/.test(engine) && /order_clips_by_dialogue\.js/.test(engine));
ok('an unordered export is never presented as ordered',
   /the order Flow wrote them, which is NOT story order/.test(engine));
ok('the downloaded originals are copied, never moved',
   /fs\.copyFileSync\(f, dest\)/.test(engine));

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
