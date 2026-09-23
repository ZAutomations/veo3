// Tests for extend_prompts.js - turning a story written for standalone clips
// into prompts that make sense in Flow's Extend box ("What happens next?").
//
// WHY THIS EXISTS. The Scenes/Ingredients route builds clip 1 and then gets
// every later clip by extending it, carrying the last frame forward. Every
// scene prompt a story carries, though, OPENS by re-establishing the whole film
// - the room, the blocking rule, the wardrobe - and CLOSES with a camera
// direction. On stories/the_price_of_obligation that opening is 895 identical
// characters in all 14 scenes. Handed to an extend, that reads as a new shot
// brief and the model re-stages the frame instead of continuing it.
//
// The derivation has to survive a story whose stored fields no longer match the
// text baked into its own prompts (true of that story: its `blocking` field was
// rewritten after its prompts were generated), so nothing is matched against
// preset text - the shared block is FOUND as the longest prefix every scene
// agrees on. These tests pin that down, plus every refusal, without a browser.
//
// Run: node test_extend_prompts.js     (no network, no Flow, no credits)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const E = require('./extend_prompts.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
}
const HERE = __dirname;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-extend-'));

console.log('\n--- a prompt is read apart at its markers ---');
const P = '[SHOT] The room. The rule. Tari turns away. The camera is a wide shot.\n'
        + '[LOOK] Photorealistic 4K.\n[AUDIO] Tari: "No."';
ok('the body is what is between [SHOT] and [LOOK]',
   E.sceneBody(P) === 'The room. The rule. Tari turns away. The camera is a wide shot.', E.sceneBody(P));
ok('the lines come back verbatim', E.audioPart(P) === 'Tari: "No."', E.audioPart(P));
ok('a prompt with no [LOOK] still yields its body',
   E.sceneBody('[SHOT] A room.\n[AUDIO] Quiet.') === 'A room.');
ok('a prompt with no [AUDIO] has no lines', E.audioPart('[SHOT] A room.') === '');
ok('internal spacing in the lines survives', (() => {
    const two = '[SHOT] R.\n[AUDIO] A: "one."  B: "two."';
    return E.audioPart(two) === 'A: "one."  B: "two."';
})());
ok('an empty prompt is empty, not a crash', E.sceneBody('') === '' && E.audioPart('') === '');

console.log('\n--- the shared block is found, not assumed ---');
ok('a common prefix is the run they agree on',
   E.sharedPrefix(['abcXYZ', 'abcPQR']) === 'abc');
ok('no agreement is an empty block', E.sharedPrefix(['abc', 'xyz']) === '');
ok('one string is its own prefix', E.sharedPrefix(['abc']) === 'abc');
ok('an empty list has no prefix', E.sharedPrefix([]) === '');
ok('the run is cut back to whole sentences', (() => {
    // "The room. The ru" must become "The room. " - never half a word.
    const b = E.wholeSentences('The room. The ru');
    return b === 'The room. ';
})());
ok('a block with no sentence end is refused', E.wholeSentences('The room and the') === null);
ok('a trailing camera direction is dropped', (() => {
    const a = E.stripCamera('Tari turns away. The camera is a wide two-shot at eye level, both in frame.');
    return a === 'Tari turns away.', a;
})());
// Only a TRAILING direction is dropped. One that opens the action is followed
// by the action itself, so it is not the prompt's sign-off and stays.
ok('a camera direction that is not at the end is left alone',
   E.stripCamera('The camera is a wide shot. Tari turns away.')
   === 'The camera is a wide shot. Tari turns away.');

console.log('\n--- a whole story, derived ---');
// Two scenes sharing the long establishing block a real story carries.
const BLOCK = 'A cozy, dimly lit bedroom during late evening, featuring a plush bed on one side and a '
    + 'minimalist fabric couch on the other. A soft warm glow comes from a single bedside lamp. '
    + 'SPATIAL BLOCKING (LOCKED): they never swap sides and the camera never crosses the axis. ';
const story = {
    scenes: [
        { _scene_number: 1, veo3_prompt: `[SHOT] ${BLOCK}Tari looks up. The camera is a wide two-shot.\n`
            + '[LOOK] Photorealistic 4K.\n[AUDIO] Tari: "I\'m reading here."' },
        { _scene_number: 2, veo3_prompt: `[SHOT] ${BLOCK}Godwin frowns. The camera is a wide two-shot.\n`
            + '[LOOK] Photorealistic 4K.\n[AUDIO] Godwin: "Come to bed."' },
        { _scene_number: 3, veo3_prompt: `[SHOT] ${BLOCK}Godwin stands. The camera is a wide two-shot.\n`
            + '[LOOK] Photorealistic 4K.\n[AUDIO] Godwin: "Now."' },
    ],
};
const r = E.deriveExtendPrompts(story);
ok('it derives', r.ok, r.reason);
ok('clip 1 is not an extend, so it is not included', r.prompts[1] === undefined);
ok('scene 2 is included', typeof r.prompts[2] === 'string');
ok('every later scene is included', Object.keys(r.prompts).join(',') === '2,3', Object.keys(r.prompts).join(','));
ok('the room is gone from the extend', !r.prompts[2].includes('plush bed'));
ok('the blocking rule is gone', !r.prompts[2].includes('SPATIAL BLOCKING'));
ok('the camera direction is gone', !/The camera is/.test(r.prompts[2]));
ok('the look block is gone', !r.prompts[2].includes('[LOOK]'));
ok('this scene\'s own action is kept', r.prompts[2].includes('Godwin frowns.'));
ok('the next scene keeps ITS action, not this one\'s', (() => {
    return r.prompts[3].includes('Godwin stands.') && !r.prompts[3].includes('Godwin frowns.');
})());
ok('the lines are kept verbatim', r.prompts[2].includes('[AUDIO] Godwin: "Come to bed."'));
ok('the dialogue survives word for word', (() => {
    return E.audioPart(r.prompts[2]) === E.audioPart(story.scenes[1].veo3_prompt);
})());
ok('it is told to continue, not to cut', r.prompts[2].startsWith(E.CONTINUE_LINE));
ok('the block it dropped is reported back', r.block.includes('plush bed') && r.block.includes('SPATIAL BLOCKING'));
ok('the reported block is whole sentences', E.wholeSentences(r.block + ' ') !== null);

console.log('\n--- --to stops at the scene asked for ---');
ok('--to 2 covers only scene 2',
   Object.keys(E.deriveExtendPrompts(story, 2).prompts).join(',') === '2');
ok('--to 3 covers 2 and 3',
   Object.keys(E.deriveExtendPrompts(story, 3).prompts).join(',') === '2,3');
ok('--to 0 means every scene after the first',
   Object.keys(E.deriveExtendPrompts(story, 0).prompts).join(',') === '2,3');
ok('--to 1 is nothing at all, and says so', (() => {
    const t = E.deriveExtendPrompts(story, 1);
    return t.ok === false;
})());

console.log('\n--- it refuses rather than inventing a prompt ---');
const noShare = { scenes: [
    { _scene_number: 1, veo3_prompt: '[SHOT] One room entirely.\n[AUDIO] A.' },
    { _scene_number: 2, veo3_prompt: '[SHOT] A different place altogether.\n[AUDIO] B.' },
] };
const ns = E.deriveExtendPrompts(noShare);
ok('scenes that share no opening block are refused', ns.ok === false);
ok('and the refusal explains the risk', /no reliable way to tell/.test(ns.reason), ns.reason);
const short = { scenes: [
    { _scene_number: 1, veo3_prompt: '[SHOT] Short. A.\n[AUDIO] A.' },
    { _scene_number: 2, veo3_prompt: '[SHOT] Short. B.\n[AUDIO] B.' },
] };
ok('a shared block too short to be the establishing text is refused',
   E.deriveExtendPrompts(short).ok === false);
ok('a one-scene story is refused',
   E.deriveExtendPrompts({ scenes: [story.scenes[0]] }).ok === false);
ok('a story with no scenes is refused', E.deriveExtendPrompts({}).ok === false);
ok('a scene with no [SHOT] text is refused', (() => {
    const b = { scenes: [story.scenes[0], story.scenes[1], { _scene_number: 3, veo3_prompt: '   ' }] };
    const x = E.deriveExtendPrompts(b);
    return x.ok === false && /no \[SHOT\] text/.test(x.reason);
})(), E.deriveExtendPrompts({ scenes: [story.scenes[0], story.scenes[1], { _scene_number: 3, veo3_prompt: '   ' }] }).reason);
// A scene that is nothing BUT the shared block has no action of its own; it
// must be skipped and said so, not handed an extend prompt that says nothing.
const nothingOwn = { scenes: [
    story.scenes[0],
    story.scenes[1],
    { _scene_number: 3, veo3_prompt: `[SHOT] ${BLOCK}\n[LOOK] Photorealistic 4K.\n[AUDIO] Godwin: "Now."` },
] };
const no = E.deriveExtendPrompts(nothingOwn);
ok('a scene whose whole body is the shared block is skipped', no.skipped.join(',') === '3', JSON.stringify(no.skipped));
ok('the other scenes still get prompts', Object.keys(no.prompts).join(',') === '2');

console.log('\n--- through the real CLI, on a real story folder ---');
const DIR = path.join(TMP, 'the_test_film');
fs.mkdirSync(path.join(DIR, 'clips'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'the_test_film_story.json'), JSON.stringify(story, null, 2));
const TOOL = path.join(HERE, 'extend_prompts.js');
const sh = (args) => {
    const x = spawnSync(process.execPath, [TOOL, ...args], { cwd: HERE, encoding: 'utf8' });
    return { code: x.status, out: (x.stdout || '') + (x.stderr || '') };
};
const OUT = path.join(DIR, 'extend_prompts.json');

const dry = sh([DIR, '--to', '2']);
ok('the CLI runs on a story folder', dry.code === 0, dry.out.slice(-400));
ok('it prints the prompt it would use', /scene 2/.test(dry.out) && dry.out.includes('Godwin frowns.'));
ok('it names the block it drops', /Dropped from every scene/.test(dry.out));
ok('--dry run writes nothing', !fs.existsSync(OUT));

const wr = sh([DIR, '--to', '2', '--write']);
ok('--write succeeds', wr.code === 0, wr.out.slice(-300));
ok('it wrote the file beside the story', fs.existsSync(OUT));
const saved = JSON.parse(fs.readFileSync(OUT, 'utf8'));
ok('only the scenes asked for are in it', Object.keys(saved.prompts).join(',') === '2');
ok('the file explains why it exists', /carried frame|already/.test(saved.note || ''), saved.note);
ok('it records which story it came from', saved.derivedFrom === 'the_test_film_story.json');
ok('the story JSON itself is untouched', (() => {
    const s = JSON.parse(fs.readFileSync(path.join(DIR, 'the_test_film_story.json'), 'utf8'));
    return s.scenes[1].veo3_prompt.includes('SPATIAL BLOCKING');
})());
ok('writing again replaces rather than appends',
   sh([DIR, '--to', '3', '--write']).code === 0
   && Object.keys(JSON.parse(fs.readFileSync(OUT, 'utf8')).prompts).join(',') === '2,3');

console.log('\n--- the engine picks the file up, and falls back without it ---');
const engine = fs.readFileSync(path.join(HERE, 'veo3_flow_new_ui.js'), 'utf8');
ok('the engine looks for extend_prompts.json beside the story',
   /extend_prompts\.json/.test(engine));
ok('the extend uses it in place of the scene prompt',
   /extendText \|\| scene\.veo3_prompt/.test(engine));
ok('clip 1 is left on the story\'s own prompt',
   /await this\.typePrompt\(scene\.veo3_prompt\);/.test(engine));

const refused = sh([path.join(TMP, 'nope')]);
ok('a path that is not a story is refused', refused.code !== 0 && /Not a story JSON/.test(refused.out));

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
