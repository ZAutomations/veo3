// Tests for order_clips_by_dialogue.js - putting a downloaded clip set back into
// story order by listening to what each clip says.
//
// WHY THIS EXISTS. Agent Mode hands Flow all N scenes in one prompt, Flow queues
// them and renders them as the queue drains, and the project grid fills up in
// COMPLETION order. So the grid - and the file numbers agent_download.js writes
// from it - have nothing to do with the story. Measured on a real run of
// stories/the_price_of_obligation, grid position 1 was story scene 11 and the
// grid read 11,13,10,14,12,5,7,6,3,9,2,8,4,1 - not the story order, and not its
// reverse either. joining that as-is produced a shuffled film.
//
// The one thing in a clip that is unique to its scene is the words it speaks, so
// the fix is to transcribe locally (whisper, no API key) and match. The matching
// is what these tests pin down; the transcription is exercised end-to-end below
// through the transcript cache, so no model and no audio are needed here.
//
// Run: node test_clip_order.js     (no network, no whisper, no credits)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const O = require('./order_clips_by_dialogue.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
}
const HERE = __dirname;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-order-'));

console.log('\n--- what a clip says is reduced to comparable words ---');
// whisper drops punctuation and renders "I'm" as "i m", so neither may matter.
ok('case and punctuation are ignored',
   O.words('Did you marry me?').size === O.words('did you marry me').size);
ok('"i m" matches "I am"', O.words("I'm reading here").has('reading'));
ok('single letters are dropped', !O.words('a I x').has('a'));
ok('a number in a line survives', O.words('I paid 500 dollars').has('500'));
ok('an empty transcript is an empty set', O.words('').size === 0);
ok('null is an empty set, not a crash', O.words(null).size === 0);

console.log('\n--- which words a scene contributes ---');
ok('dialogue is what the characters say', (() => {
    const w = O.sceneWords({ dialogue: [{ speaker: 'A', line: 'Come to bed.' }], script_line: 'ignored' });
    return w.from === 'dialogue' && w.text === 'Come to bed.';
})());
ok('several lines are joined', (() => {
    const w = O.sceneWords({ dialogue: [{ line: 'One.' }, { line: 'Two.' }] });
    return w.text === 'One. Two.';
})());
ok('a narrator-only scene falls back to its script line',
   O.sceneWords({ script_line: 'The room is quiet.' }).from === 'script_line');
ok('a scene with neither is reported as unidentifiable',
   O.sceneWords({ dialogue: [], script_line: '' }).from === 'none');
ok('a speaker-less dialogue entry still counts', (() => {
    const w = O.sceneWords({ dialogue: [{ line: 'Just a line.' }] });
    return w.from === 'dialogue' && w.text === 'Just a line.';
})());
ok('blank lines do not become the scene text', (() => {
    const w = O.sceneWords({ dialogue: [{ line: '   ' }], script_line: 'Narrated.' });
    return w.from === 'script_line';
})());
ok('scene numbers come from the story, not the array position', (() => {
    const w = O.wantedFrom({ scenes: [{ _scene_number: 7, _scene_title: 'S' }] });
    return w[0].n === 7;
})());
ok('a scene without a number falls back to its position', (() => {
    const w = O.wantedFrom({ scenes: [{ dialogue: [{ line: 'a b' }] }, { dialogue: [{ line: 'c d' }] }] });
    return w[1].n === 2;
})());

console.log('\n--- matching a clip to the scene it speaks ---');
// Four scenes, four clips, deliberately shuffled - the real failure mode.
const SCENES = [
    { n: 1, title: 'One', text: 'Did you marry me to have a debtor' },
    { n: 2, title: 'Two', text: 'Intimacy is my marital right' },
    { n: 3, title: 'Three', text: 'Stop treating me like some kind of animal' },
    { n: 4, title: 'Four', text: 'I work all day to provide' },
];
const WANTED = SCENES.map(s => ({ n: s.n, title: s.title, text: s.text, from: 'dialogue' }));
const CLIPS = ['scene-01.mp4', 'scene-02.mp4', 'scene-03.mp4', 'scene-04.mp4'];
const shuffled = {
    // scene-01.mp4 turned out to be story scene 3, and so on.
    'scene-01.mp4': 'Stop treating me like some kind of animal',
    'scene-02.mp4': 'I work all day to provide for us',
    'scene-03.mp4': 'Did you marry me to have a debtor',
    'scene-04.mp4': 'Intimacy is my marital right, Tari',
};
const m = O.matchClips(CLIPS, shuffled, WANTED);
ok('every clip is identified', Object.values(m.byFile).every(x => x.cover !== null));
ok('nothing is left unresolved', m.unresolved.length === 0);
ok('scene-01.mp4 is really scene 3', m.byFile['scene-01.mp4'].scene === 3);
ok('scene-02.mp4 is really scene 4', m.byFile['scene-02.mp4'].scene === 4);
ok('scene-03.mp4 is really scene 1', m.byFile['scene-03.mp4'].scene === 1);
ok('scene-04.mp4 is really scene 2', m.byFile['scene-04.mp4'].scene === 2);
ok('a clip that says the whole line scores 1.0', m.byFile['scene-01.mp4'].cover === 1);
ok('every scene is claimed by exactly one clip',
   new Set(Object.values(m.byFile).map(x => x.scene)).size === 4);

const ordered = O.orderOf(CLIPS, m.byFile);
ok('story order comes out as the file list', ordered.join(',')
   === 'scene-03.mp4,scene-04.mp4,scene-01.mp4,scene-02.mp4', ordered.join(','));
ok('the order string is what join_clips --order wants',
   O.orderString(ordered) === 'scene-03,scene-04,scene-01,scene-02', O.orderString(ordered));

console.log('\n--- one clip per scene, never two ---');
// Two clips both contain scene 1's words because the story repeats a phrase.
// The stronger match must take it; the other must not steal it as well.
const dup = {
    'scene-01.mp4': 'Did you marry me to have a debtor',
    'scene-02.mp4': 'Did you marry me',            // partial, scene 1 again
    'scene-03.mp4': 'Stop treating me like some kind of animal',
};
const m2 = O.matchClips(['scene-01.mp4', 'scene-02.mp4', 'scene-03.mp4'], dup, WANTED);
ok('the full quote wins the scene', m2.byFile['scene-01.mp4'].scene === 1);
ok('the partial quote does not also claim it', m2.byFile['scene-02.mp4'].scene !== 1);
ok('and is reported instead of guessed at', m2.byFile['scene-02.mp4'].cover === null);
ok('it is listed as unresolved', m2.unresolved.includes('scene-02.mp4'));
ok('the unrelated clip still resolves', m2.byFile['scene-03.mp4'].scene === 3);

console.log('\n--- a weak or empty transcript is never forced onto a scene ---');
const thin = O.matchClips(['a.mp4'], { 'a.mp4': 'marry me' }, WANTED);
ok('a clip that only shares one word of a line is not that line',
   thin.byFile['a.mp4'].cover === null, JSON.stringify(thin.byFile['a.mp4']));
const silent = O.matchClips(['a.mp4'], { 'a.mp4': '' }, WANTED);
ok('a silent clip is unresolved', silent.byFile['a.mp4'].cover === null);
ok('a clip about something else matches nothing',
   O.matchClips(['a.mp4'], { 'a.mp4': 'the weather was lovely today and the bus was late' },
       WANTED).byFile['a.mp4'].cover === null);
// A scene whose whole line is grammar shares no MEANING with anything, so no clip
// may be reported as having matched it - only placed there and flagged.
ok('a scene of nothing but function words cannot pull a clip in', (() => {
    const w = [{ n: 1, title: 'T', text: 'you and the of', from: 'dialogue' }];
    const r = O.matchClips(['a.mp4'], { 'a.mp4': 'you and the of' }, w);
    return r.byFile['a.mp4'].cover === null && r.unresolved.includes('a.mp4');
})());
ok('and a scene that says only one word still can', (() => {
    const w = [{ n: 1, title: 'T', text: 'Yes', from: 'dialogue' }];
    return O.matchClips(['a.mp4'], { 'a.mp4': 'Yes.' }, w).byFile['a.mp4'].cover === 1;
})());
ok('the threshold is adjustable', (() => {
    const soft = O.matchClips(['a.mp4'], { 'a.mp4': 'marry debtor' }, WANTED, 0.2);
    return soft.byFile['a.mp4'].scene === 1;
})());

console.log('\n--- an unidentifiable clip is placed, and flagged, never silently right ---');
// Two clips are identified. The third says nothing, and one scene nobody matched
// is left over - the most likely reading is that the wordless clip IS the
// wordless scene, so that is where it goes, marked cover:null so the run can say
// so. It is a placement, not a claim.
const mixed = O.matchClips(
    ['c1.mp4', 'c2.mp4', 'c3.mp4'],
    { 'c1.mp4': 'I work all day to provide', 'c2.mp4': '', 'c3.mp4': 'Stop treating me like some kind of animal' },
    WANTED);
const mixedOrder = O.orderOf(['c1.mp4', 'c2.mp4', 'c3.mp4'], mixed.byFile);
ok('the unidentified clip takes the unmatched scene\'s place',
   mixed.byFile['c2.mp4'].scene === 1, JSON.stringify(mixed.byFile['c2.mp4']));
ok('but records no confidence', mixed.byFile['c2.mp4'].cover === null);
ok('and is listed as unresolved', mixed.unresolved.join(',') === 'c2.mp4');
ok('the identified clips keep their story order',
   mixedOrder.filter(f => mixed.byFile[f].cover !== null).join(',') === 'c3.mp4,c1.mp4',
   mixedOrder.join(','));
ok('every clip still gets a position in the film', mixedOrder.length === 3);
// With no scene left over there is nowhere to put it, so it sinks to the end
// rather than displacing a scene that was identified.
const noSpare = O.matchClips(
    ['c1.mp4', 'c2.mp4', 'c3.mp4'],
    { 'c1.mp4': 'Did you marry me to have a debtor',
      'c2.mp4': 'Intimacy is my marital right, Tari',
      'c3.mp4': '' },
    WANTED.slice(0, 2));
const noSpareOrder = O.orderOf(['c1.mp4', 'c2.mp4', 'c3.mp4'], noSpare.byFile);
ok('both scenes are claimed by the clips that speak them',
   noSpare.byFile['c1.mp4'].scene === 1 && noSpare.byFile['c2.mp4'].scene === 2);
ok('an unresolved clip with no spare scene gets no scene number',
   noSpare.byFile['c3.mp4'].scene === null);
ok('and sinks to the end', noSpareOrder[2] === 'c3.mp4', noSpareOrder.join(','));
ok('the film is still complete', new Set(noSpareOrder).size === 3);

console.log('\n--- through the real CLI, on real files ---');
// A fixture with tiny real clips and a pre-seeded transcript cache: the cache is
// what lets this run with no whisper, no model and no audio, while still driving
// the genuine command-line path including the manifest rewrite.
function sh(cmd, args, cwd) {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const DIR = path.join(TMP, 'the_test_film');
const CLIPDIR = path.join(DIR, 'clips');
const TRDIR = path.join(CLIPDIR, '.transcripts');
fs.mkdirSync(TRDIR, { recursive: true });
const FIX_SCENES = [
    { _scene_number: 1, _scene_title: 'Opening', dialogue: [{ speaker: 'A', line: 'Did you marry me to have a debtor' }] },
    { _scene_number: 2, _scene_title: 'Middle', dialogue: [{ speaker: 'B', line: 'Intimacy is my marital right, Tari' }] },
    { _scene_number: 3, _scene_title: 'Ending', dialogue: [{ speaker: 'A', line: 'Stop treating me like some kind of animal' }] },
];
fs.writeFileSync(path.join(DIR, 'the_test_film_story.json'),
    JSON.stringify({ title: 'T', scenes: FIX_SCENES }, null, 2));
// Real (tiny) mp4s, so join_clips.js can probe them exactly as it would in a run.
for (const f of ['scene-01.mp4', 'scene-02.mp4', 'scene-03.mp4']) {
    sh('ffmpeg', ['-y', '-v', 'quiet', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=8',
        '-f', 'lavfi', '-i', 'anullsrc', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', path.join(CLIPDIR, f)]);
}
// The downloader's own record, in the wrong order, exactly as a real run leaves it.
fs.writeFileSync(path.join(CLIPDIR, 'manifest.json'), JSON.stringify({
    projectUrl: 'https://flow.google.com/project/x',
    reversed: true,
    gridOrderNote: 'kept for the test',
    clips: [
        { order: 1, file: 'scene-01.mp4', tileIndex: 2, caption: 'generic' },
        { order: 2, file: 'scene-02.mp4', tileIndex: 1, caption: 'generic' },
        { order: 3, file: 'scene-03.mp4', tileIndex: 0, caption: 'generic' },
    ],
}, null, 2));
// scene-01.mp4 was really scene 2, scene-02.mp4 scene 3, scene-03.mp4 scene 1.
const SAID = {
    'scene-01.mp4': 'Intimacy is my marital right, Tari',
    'scene-02.mp4': 'Stop treating me like some kind of animal',
    'scene-03.mp4': 'Did you marry me to have a debtor',
};
const index = {};
for (const [f, text] of Object.entries(SAID)) {
    fs.writeFileSync(path.join(TRDIR, f.replace('.mp4', '.txt')), text + '\n');
    const st = fs.statSync(path.join(CLIPDIR, f));
    index[f] = { size: st.size, mtime: st.mtimeMs };
}
fs.writeFileSync(path.join(TRDIR, 'index.json'), JSON.stringify(index, null, 2));

const TOOL = path.join(HERE, 'order_clips_by_dialogue.js');
const before = fs.readFileSync(path.join(CLIPDIR, 'manifest.json'), 'utf8');
const dry = sh(process.execPath, [TOOL, DIR, '--dry-run'], HERE);
ok('the tool runs on a story folder', dry.code === 0, dry.out.slice(-400));
ok('it reports every clip resolved', /Resolved: 3 of 3 clip\(s\)/.test(dry.out), dry.out.slice(-300));
ok('it prints the story order', /Story order: scene-03,scene-01,scene-02/.test(dry.out));
ok('it names the alternative --order call', /--order scene-03,scene-01,scene-02/.test(dry.out));
ok('--dry-run changes nothing on disk',
   fs.readFileSync(path.join(CLIPDIR, 'manifest.json'), 'utf8') === before);

const wr = sh(process.execPath, [TOOL, DIR, '--write'], HERE);
ok('--write succeeds', wr.code === 0, wr.out.slice(-300));
const man = JSON.parse(fs.readFileSync(path.join(CLIPDIR, 'manifest.json'), 'utf8'));
ok('the manifest now lists the clips in story order',
   man.clips.map(c => c.file).join(',') === 'scene-03.mp4,scene-01.mp4,scene-02.mp4',
   man.clips.map(c => c.file).join(','));
ok('each clip records the scene it was heard to be',
   man.clips.map(c => c.matched_scene).join(',') === '1,2,3');
ok('and how sure the match was', man.clips.every(c => c.match_cover === 1));
ok('and where the words came from', man.clips.every(c => c.match_from === 'dialogue'));
ok('order is renumbered from 1', man.clips.map(c => c.order).join(',') === '1,2,3');
ok('the resolution is recorded as coming from dialogue', man.orderResolvedBy === 'dialogue');
ok('the download record is not lost', man.projectUrl === 'https://flow.google.com/project/x'
   && man.gridOrderNote === 'kept for the test' && man.reversed === true);
ok('the tile the clip came from is not lost', man.clips[0].tileIndex === 0);
ok('a backup of the download manifest was kept',
   fs.existsSync(path.join(CLIPDIR, 'manifest.json.before-order-backup')));
ok('the backup holds the ORIGINAL order', (() => {
    const b = JSON.parse(fs.readFileSync(path.join(CLIPDIR, 'manifest.json.before-order-backup'), 'utf8'));
    return b.clips.map(c => c.file).join(',') === 'scene-01.mp4,scene-02.mp4,scene-03.mp4';
})());

// The whole point: join_clips.js now joins correctly with no --order at all.
const jr = sh(process.execPath, [path.join(HERE, 'join_clips.js'), CLIPDIR, '--dry-run'], HERE);
ok('join_clips reads the resolved manifest', /Order from\s*: manifest\.json/.test(jr.out), jr.out.slice(0, 400));
ok('and plans the story order', (() => {
    const plan = jr.out.split('\n').filter(l => /\d+\.\s+scene-\d+\.mp4/.test(l))
        .map(l => (l.match(/scene-\d+\.mp4/) || [])[0]);
    return plan.join(',') === 'scene-03.mp4,scene-01.mp4,scene-02.mp4';
})(), jr.out.match(/scene-\d+\.mp4/g)?.join(','));

// Re-running must not clobber the preserved original record.
sh(process.execPath, [TOOL, DIR, '--write'], HERE);
ok('re-running leaves the original backup intact', (() => {
    const b = JSON.parse(fs.readFileSync(path.join(CLIPDIR, 'manifest.json.before-order-backup'), 'utf8'));
    return b.clips.map(c => c.file).join(',') === 'scene-01.mp4,scene-02.mp4,scene-03.mp4';
})());
ok('and the second run is instant because transcripts are cached',
   /Transcripts: 3 cached, 0 to transcribe/.test(sh(process.execPath, [TOOL, DIR, '--write'], HERE).out));

console.log('\n--- it refuses rather than guessing ---');
const SILENT = path.join(TMP, 'silent');
fs.mkdirSync(path.join(SILENT, 'clips'), { recursive: true });
fs.writeFileSync(path.join(SILENT, 'silent_story.json'),
    JSON.stringify({ scenes: [{ _scene_number: 1, _scene_title: 'A' }, { _scene_number: 2, _scene_title: 'B' }] }));
fs.writeFileSync(path.join(SILENT, 'clips', 'scene-01.mp4'), '');
const sr = sh(process.execPath, [TOOL, SILENT], HERE);
ok('a silent story is refused', sr.code !== 0);
ok('and says why', /fewer than two scenes have words/.test(sr.out), sr.out.slice(-200));
ok('it points at the manual route', /join_clips\.js --order/.test(sr.out));
const empty = path.join(TMP, 'empty');
fs.mkdirSync(empty, { recursive: true });
fs.writeFileSync(path.join(empty, 'empty_story.json'), JSON.stringify({ scenes: [{ _scene_number: 1 }] }));
const er = sh(process.execPath, [TOOL, empty], HERE);
ok('a missing clips folder is refused', er.code !== 0 && /No clips folder/.test(er.out));
const nf = sh(process.execPath, [TOOL, path.join(TMP, 'nope')], HERE);
ok('a path that is not a story is refused', nf.code !== 0 && /Not a story JSON/.test(nf.out));

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
