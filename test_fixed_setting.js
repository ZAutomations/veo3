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

const talk = W.loadPreset('relationship-dialogue');
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
ok('forbids naming another location', /never name a different location/.test(talkPrompt));
ok('asks for variation in framing instead', /Vary the framing/.test(talkPrompt));
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
    return s.scenes[0].narrative_context === talk.setting;
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
    return bad.some(b => /clip 2/.test(b) && /fixed setting/.test(b));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
