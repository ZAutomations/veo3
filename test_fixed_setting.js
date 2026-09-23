// Tests for the `setting` preset field - a genre that happens in ONE place for
// the whole film.
//
// Scenes are written in batches that share no state beyond the previous clip's
// spoken line, so a preset set in a single room had nothing holding the room
// still: each batch quietly chose its own, and two people talking over tea
// drifted into a different cafe every clip. The field names the place once, the
// look block states it to every batch, and buildStory repeats it into every
// [SHOT] so it holds even for a clip that ignored the instruction.
//
// Run: node test_fixed_setting.js     (no network)
const W = require('./write_story.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
}

// No preset in styles.json hardcodes a place any more - every story chooses its
// own. The `setting` field is still honoured for a genre that genuinely always
// uses one place, so this suite exercises it on a preset that declares one.
const talk = Object.assign({}, W.loadPreset('relationship-dialogue'), {
    setting: 'A quiet tearoom corner by one tall window. A round marble-topped table sits between two upholstered chairs, gauze curtains hang at the window, and a folded letter rests on the table. Warm late-afternoon light falls from the window on the left. The room is LOCKED: static background, unchanging spatial layout, the same furniture, the same light, the same camera axis in every clip - no scene transitions, no redecorating.',
    setting_name: 'Tearoom',
    setting_prompt: '2.5D semi-realistic anime illustration. An empty tearoom corner: a round marble-topped table between two empty upholstered chairs. Straight-on wide view, evenly lit. No people, no animals, no text, no labels, no watermark.',
});
const ghibli = W.loadPreset('ghibli');
const animal = W.loadPreset('animal-kindness');

console.log('\n--- the preset names one place ---');
ok('declares a setting', !!talk.setting);
ok('the setting is one room, not a menu of rooms', !/\bor\b/i.test(talk.setting || ''), talk.setting);
ok('direction no longer offers a choice of rooms', !/a cafe, a tearoom/i.test(talk.direction));
ok('direction says the room is the same all film',
   /SAME room/i.test(talk.direction) && /never move to another place/i.test(talk.direction));

console.log('\n--- the look block states it to every batch ---');
const talkLook = W.lookBlock(talk);
ok('has a SETTING line', /^SETTING \(FIXED/m.test(talkLook));
ok('the line carries the room itself', talkLook.includes(talk.setting));
ok('says the film never leaves it', /never leaves it/.test(talkLook));
ok('never prints an undefined', !/undefined/.test(talkLook), talkLook.match(/undefined.{0,40}/)?.[0]);
ok('a preset with no fixed place has no SETTING line', !/^SETTING/m.test(W.lookBlock(ghibli)));
ok('the animal preset has no SETTING line either', !/^SETTING/m.test(W.lookBlock(animal)));

console.log('\n--- the scene prompt forbids redecorating ---');
const outline = Array.from({ length: 3 }, (_, i) => ({ title: 'T' + i, beat: 'B' + i }));
const cast = [
    { name: 'Vera', type: 'human', description: 'Same Vera throughout - a woman in her seventies.' },
    { name: 'Nadia', type: 'human', description: 'Same Nadia throughout - a woman in her twenties.' },
];
const talkPrompt = W.scenesPrompt(talk, cast, outline, 0, 3, []);
ok('says THE PLACE IS FIXED', /THE PLACE IS FIXED/.test(talkPrompt));
ok('forbids re-describing the room', /do NOT\s+describe it/i.test(talkPrompt));
ok('forbids moving the pair', /do NOT move the two of/i.test(talkPrompt));
ok('locks their positions, not just the room', /THEIR POSITIONS ARE FIXED TOO/.test(talkPrompt));
ok('forbids naming another location', /never name a different location/.test(talkPrompt));
ok('asks for variation in action and expression instead',
   /Vary only the action, the expression and the\s+camera angle/.test(talkPrompt));
// The camera is the one thing the preset still lets vary, so it has to say how.
// "Vary the framing" was too loose: it read as licence to move the pair around
// the room, which is the drift the fixed setting exists to stop. The rule is
// now an angle chosen by who is speaking, named in the text, on one axis.
ok('names the camera angle as the thing that varies', /CAMERA ANGLE/.test(talkPrompt));
ok('picks the angle by who is speaking', /over-the-shoulder medium close-up/.test(talkPrompt));
ok('falls back to the two-shot for a wordless beat', /wide two-shot at eye level/.test(talkPrompt));
ok('keeps the camera on one axis', /never pan, never zoom/.test(talkPrompt));
ok('the room reaches the prompt', talkPrompt.includes(talk.setting));
ok('the brief drops to a 60-100 word range', /60 to 100 words/.test(talkPrompt));
const ghibliPrompt = W.scenesPrompt(ghibli, cast, outline, 0, 3, []);
ok('a preset with no fixed place is never told about one', !/THE PLACE IS FIXED/.test(ghibliPrompt));
ok('and keeps the ordinary narrative_context brief', /80 to 130 words/.test(ghibliPrompt));

console.log('\n--- every clip carries the room, verbatim ---');
const meta = { description: 'd', moral: 'm', target_audience: 'a' };
const scenes = [
    { scene_title: 'Hook', dialogue: [{ speaker: 'Vera', line: 'Sit down.' }],
      narrative_context: 'A wide two-shot. Vera sets down her cup.', characters: ['vera', 'nadia'] },
    { scene_title: 'Doubt', dialogue: [{ speaker: 'Nadia', line: 'But what if?' }],
      narrative_context: 'An over-the-shoulder single on Nadia.', characters: ['vera', 'nadia'] },
    { scene_title: 'Answer', dialogue: [{ speaker: 'Vera', line: 'Then listen.' }],
      narrative_context: 'A medium close-up on Vera.', characters: ['vera', 'nadia'] },
];
const story = W.buildStory(talk, cast, meta, scenes);
ok('clip 1 opens with the room', story.scenes[0].narrative_context.startsWith(talk.setting));
ok('clip 2 opens with the same room', story.scenes[1].narrative_context.startsWith(talk.setting));
ok('clip 3 does too', story.scenes[2].narrative_context.startsWith(talk.setting));
ok('all three say it identically',
   new Set(story.scenes.map(s => s.narrative_context.slice(0, talk.setting.length))).size === 1);
ok('every [SHOT] line carries it', story.scenes.every(s => s.veo3_prompt.startsWith(`[SHOT] ${talk.setting}`)));
ok('the room comes before the clip\'s own description',
   story.scenes[0].narrative_context.indexOf(talk.setting)
   < story.scenes[0].narrative_context.indexOf('wide two-shot'));
ok('each clip keeps its own action',
   /wide two-shot/i.test(story.scenes[0].narrative_context) &&
   /over-the-shoulder/i.test(story.scenes[1].narrative_context) &&
   /medium close-up/i.test(story.scenes[2].narrative_context));
ok('the room appears once per shot, not twice',
   story.scenes[0].veo3_prompt.split(talk.setting).length - 1 === 1);
ok('a preset with no fixed place is left exactly as it was', (() => {
    const s = W.buildStory(ghibli, cast, meta, [
        { scene_title: 'T', script_line: 'A line.', narrative_context: 'A wide shot.',
          characters: ['vera'] },
    ]);
    return s.scenes[0].narrative_context === 'A wide shot.';
})());
ok('an empty narrative_context does not leave a trailing space', (() => {
    const s = W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [{ speaker: 'Vera', line: 'x' }],
          narrative_context: '', characters: ['vera'] },
    ]);
    // The preset contributes two locked pieces here - the room and the spatial
    // blocking - and the empty context must add neither a trailing space nor a
    // gap between them. An exact match is the strictest way to say "nothing
    // else leaked in".
    return s.scenes[0].narrative_context === [talk.setting, talk.blocking].filter(Boolean).join(' ');
})());
ok('a whitespace-only context leaves no gap either', (() => {
    const build = (ctx) => W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [{ speaker: 'Vera', line: 'x' }],
          narrative_context: ctx, characters: ['vera'] },
    ]).scenes[0].narrative_context;
    const blank = build('');
    return build('   ') === blank && !/\s\s|\s$/.test(blank);
})());

console.log('\n--- validate holds the line ---');
ok('accepts a story where every clip carries the room',
   W.validate(story, cast, talk).length === 0, W.validate(story, cast, talk).join(' | '));
// The hand-written and legacy JSON never passes through the scene prompt, so
// this is the only thing standing between it and a film that changes room.
ok('rejects a clip that lost the room', (() => {
    const s = JSON.parse(JSON.stringify(story));
    s.scenes[1].narrative_context = 'A different cafe across town.';
    const bad = W.validate(s, cast, talk);
    return bad.some(b => /clip 2/.test(b) && /fixed place/.test(b));
})());
ok('names which clip went wrong', (() => {
    const s = JSON.parse(JSON.stringify(story));
    s.scenes[2].narrative_context = 'A sunlit veranda at dusk.';
    return W.validate(s, cast, talk).some(b => /clip 3/.test(b));
})());
ok('a preset with no fixed place never demands one',
   W.validate(W.buildStory(ghibli, cast, meta, [
       { scene_title: 'T', script_line: 'A line.', narrative_context: 'anywhere at all',
         characters: ['vera'] }]), cast, ghibli).length === 0);

console.log('\n--- the rule reaches the converter the agent reads ---');
ok('the story keeps the room in every clip', (() => {
    const s = W.buildStory(talk, cast, meta, scenes);
    return s.scenes.every(x => x.narrative_context.includes(talk.setting));
})());

console.log('\n--- the same idea one level down: WHERE they are ---');
// A locked room still lets two people re-stage themselves inside it. Every clip
// is written as its own model call that has never seen clip 1, so "keep them
// where they were" is unanswerable for it - and each call answered it
// differently, which is a couple who sit on the bed in clip 1 and stand at the
// window in clip 4. The fix mirrors the room's: the arrangement is chosen once,
// by the one call that sees the whole film, and restated verbatim into every
// clip. See the two-hander in stories/the_price_of_obligation.
const ARR = 'Vera sits on the edge of the bed at frame-left, forearms on her knees, facing right. '
          + 'Nadia sits on the couch at frame-right with a closed book in her lap, facing left.';

console.log('\n--- only a genre that declares blocking is asked for one ---');
ok('the preset offers the rule', !!talk.blocking);
const talkCall1 = W.castPrompt(talk);
ok('call 1 is asked to fix the pair in place', /Fix WHERE THE TWO OF THEM ARE/.test(talkCall1));
ok('it asks for the "blocking" field', /"blocking":""/.test(talkCall1));
ok('it wants 25 to 45 words', /"blocking" - 25 to 45 words/.test(talkCall1));
ok('it wants a still state, not a movement', /write a fixed state, never a moment and never a movement/i.test(talkCall1));
ok('it says the words are repeated verbatim', /repeated WORD FOR WORD into\s+every clip/i.test(talkCall1));
ok('it names the failure it is preventing',
   /sitting on the bed in one\s+clip and standing at the window in the next/i.test(talkCall1));
ok('it opens the escape hatch for one story beat', /a beat the\s+story itself is about/i.test(talkCall1));
ok('the outline beats are told they are not a reason to move',
   /They stay where the BLOCKING above puts them/.test(talkCall1));
ok('a preset with no blocking word is not asked', !/"blocking":""/.test(W.castPrompt(ghibli)));
ok('and is told nothing about stage positions', !/Fix WHERE THE TWO OF THEM ARE/.test(W.castPrompt(ghibli)));

console.log('\n--- the arrangement reaches every clip, word for word ---');
const heldPrompt = W.scenesPrompt(talk, cast, outline, 0, 3, [], talk.setting, ARR);
ok('the batch is handed the stage positions', /THE STAGE POSITIONS FOR THE WHOLE FILM/.test(heldPrompt));
ok('and the arrangement itself, exactly', heldPrompt.includes(ARR));
ok('it says this holds from the first clip to the last',
   /where they are in clip 1 and where they are in the last clip/.test(heldPrompt));
ok('the clip brief refuses to re-seat them', /do NOT seat them somewhere else/.test(heldPrompt));
ok('and refuses to stand them up', /do NOT stand them up/.test(heldPrompt));
ok('and forbids crossing the room', /never walk them across the room/.test(heldPrompt));
ok('and forbids swapping sides', /never swap their sides/.test(heldPrompt));
ok('it keeps the one permitted move', /Every clip after that one keeps them there/.test(heldPrompt));
ok('it is stated once for the batch, not once per clip',
   (heldPrompt.match(/WHERE THEY ARE IS FIXED TOO/g) || []).length === 1);
// The rule is only worth stating when there is an arrangement for it to point
// at: a preset with a locked room and no positions must not be told to obey a
// block that is not in the prompt.
const noArr = W.scenesPrompt(talk, cast, outline, 0, 3, [], talk.setting);
ok('with no arrangement there is no stage block', !/THE STAGE POSITIONS/.test(noArr));
ok('and no rule pointing at one that is not there', !/the STAGE POSITIONS above/.test(noArr));
ok('the room lock is still there on its own', /THE PLACE IS FIXED/.test(noArr));
ok('a genre that declares no blocking is untouched',
   !/THE STAGE POSITIONS|WHERE THEY ARE IS FIXED TOO/.test(
       W.scenesPrompt(ghibli, cast, outline, 0, 3, [], 'A meadow.', '')));

console.log('\n--- every clip of the story carries it ---');
const staged = W.buildStory(talk, cast, Object.assign({}, meta, { blocking: ARR }), scenes);
ok('the story records the arrangement', staged.blocking === ARR, staged.blocking);
ok('clip 1 carries it', staged.scenes[0].narrative_context.includes(ARR));
ok('clip 2 carries it', staged.scenes[1].narrative_context.includes(ARR));
ok('clip 3 carries it', staged.scenes[2].narrative_context.includes(ARR));
ok('all three carry it identically',
   new Set(staged.scenes.map(s => s.narrative_context.split(ARR)[0])).size === 1);
ok('it sits after the place and before the clip action', (() => {
    const c = staged.scenes[0].narrative_context;
    return c.indexOf(talk.setting) < c.indexOf(ARR) && c.indexOf(ARR) < c.indexOf('wide two-shot');
})());
ok('the [SHOT] line carries it too',
   staged.scenes.every(s => s.veo3_prompt.includes(ARR)));
ok('it appears once per shot, not twice', (() => {
    const withRule = W.buildStory(talk, cast, Object.assign({}, meta, { blocking: ARR }), scenes);
    return withRule.scenes[0].veo3_prompt.split(ARR).length - 1 === 1;
})());
// The whole point of keeping it on the story: a story written before this field
// existed has none, and must come out byte-identical to how it did before.
ok('no arrangement means no change to the story', (() => {
    const s = W.buildStory(talk, cast, meta, [
        { scene_title: 'T', dialogue: [{ speaker: 'Vera', line: 'x' }],
          narrative_context: '', characters: ['vera'] },
    ]);
    return !('blocking' in s) &&
        s.scenes[0].narrative_context === [talk.setting, talk.blocking].filter(Boolean).join(' ');
})());

console.log('\n--- what the agent reads ---');
// Through the real converter, on a temp copy, so this asserts the whole chain:
// the writer puts the arrangement in every clip, and the prompt builder prints
// the block that says the repetition is deliberate.
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONV = path.join(__dirname, 'story_to_agent_prompt.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-blocking-'));
function agentPromptFor(story) {
    const f = path.join(tmp, 'story.json');
    fs.writeFileSync(f, JSON.stringify(story, null, 2));
    const r = require('child_process').spawnSync(process.execPath, [CONV, f, '--print'], { encoding: 'utf8' });
    return { out: r.stdout || '', status: r.status, err: r.stderr };
}
const conv = agentPromptFor(staged);
const body = conv.out;
ok('the prompt builder accepted the staged story', conv.status === 0, conv.err);
ok('it prints a BLOCKING block', /BLOCKING - FIXED\./.test(body), body.slice(0, 400));
ok('the block carries the arrangement verbatim', body.includes(ARR));
ok('it says the sides never swap', /stays on the left/.test(body));
ok('it says this is not a montage', /not a montage/.test(body));
ok('the closing rule repeats it', /Every clip has the characters in the BLOCKING positions/.test(body));
ok('the summary reports it', /blocking   : one arrangement for the whole film/.test(body), body.slice(-400));
ok('it introduces no new @mention', (() => {
    const M = require('./mention_target.js');
    const names = (body.match(/@([A-Za-z0-9_.\-]+)/g) || []).map(x => x.slice(1));
    // The arrangement is prose with no "@" in it, so the mention list is the
    // same three references with or without it - which is what keeps the film
    // inside Veo's three-image ceiling.
    return names.length > 0 && M.distinctMentions(names).length === 3;
})(), (body.match(/@[A-Za-z0-9_.\-]+/g) || []).join(','));
ok('a story with no blocking gets no BLOCKING block',
   !/BLOCKING - FIXED\./.test(agentPromptFor(W.buildStory(talk, cast, meta, scenes)).out));
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
