// Tests for the hook and the ask: the two clips that are not like the others.
//
// The run this exists for: a Zack D. style film came back with a plain
// statement for clip 1 ("A square egg would stay put and never roll away.") and
// a closing summary for clip 6 ("The exact reasons behind diverse avian egg
// geometries remain an open scientific question."). No hook, no ask.
//
// The preset already spelled the whole HOOK / BODY / ASK contract out, and it
// WAS reaching the clip writer - lookBlock prints `DIRECTION:` and lookBlock is
// in that prompt. Two things were still wrong:
//
//   1. Nothing told the writer that clip 1 and the last clip are written
//      DIFFERENTLY. It fills the fields listed under "For EACH clip above", and
//      `script_line` reads the same for all six, so all six came out the same
//      shape and the direction was left as background about the visuals.
//   2. The last thing the writer read was the preset's NEVER list - "no begging
//      for likes, no subscribe-style hard sell" - and an ask IS a call to
//      action. The one clip that has to address the viewer was the one clip
//      told not to.
//
// Run: node test_clip_contract.js     (no browser, no network, nothing sent)
const fs = require('fs');
const path = require('path');
const W = require('./write_story.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + extra : ''}`); }
}

const STYLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'styles.json'), 'utf8')).styles;
const ZACK = STYLES.find((x) => x.id === '3d-zack-style');
const OTHER = STYLES.find((x) => x.id !== '3d-zack-style' && !x.hook_line && !x.ask_line);

const cast = [{ name: 'Mira', description: 'the same Mira throughout' }];
const outline = (n) => Array.from({ length: n }, (_, i) => ({ title: `Beat ${i + 1}`, beat: '(a beat)' }));
const prompt = (p, n, from, to) => W.scenesPrompt(p, cast, outline(n), from, to, [], undefined, undefined);

const HOOK = /CLIP 1, THE HOOK/;
const ASK = /THE LAST CLIP, THE ASK/;

console.log('\n--- the preset carries the two contract lines ---');
{
    ok('the Zack D. preset declares a hook', typeof ZACK.hook_line === 'string' && ZACK.hook_line.length > 40);
    ok('and an ask', typeof ZACK.ask_line === 'string' && ZACK.ask_line.length > 40);
    ok('the hook is about opening cold on the shocking image', /open cold on the single most shocking image/i.test(ZACK.hook_line));
    ok('and forbids the things the preset always forbade',
       /never a walk-in/.test(ZACK.hook_line) && /never a greeting/.test(ZACK.hook_line));
    ok('the ask is one short warm sentence, not a list', /ONE short warm sentence/.test(ZACK.ask_line));
    ok('no other preset grew either line',
       STYLES.filter((x) => x.hook_line || x.ask_line).map((x) => x.id).join(',') === '3d-zack-style');
}

console.log('\n--- clip 1 gets the hook, and only in the batch that holds it ---');
{
    const first = prompt(ZACK, 6, 0, 3);
    ok('the first batch carries the hook', HOOK.test(first));
    ok('and not the ask - clip 6 is not in it', !ASK.test(first));
    ok('the hook is stated as an override of the general clip spec',
       /overrides the general/.test(first));
    ok('and it sits with the beats it applies to',
       first.indexOf('THE BEATS FOR THESE CLIPS') < first.indexOf('CLIP 1, THE HOOK'));

    const later = prompt(ZACK, 6, 2, 4);
    ok('a batch that does not hold clip 1 has no hook', !HOOK.test(later), 'clips 3-4');

    const whole = prompt(ZACK, 6, 0, 6);
    ok('a batch that spans the whole film carries it', HOOK.test(whole));
}

console.log('\n--- the last clip gets the ask, and only in the batch that holds it ---');
{
    const last = prompt(ZACK, 6, 3, 6);
    ok('the last batch carries the ask', ASK.test(last));
    ok('and names WHICH clip is the last one', /CLIP 6, THE LAST CLIP, THE ASK/.test(last));
    ok('and not the hook - clip 1 is not in it', !HOOK.test(last));

    const middle = prompt(ZACK, 6, 3, 5);
    ok('a middle batch carries neither', !HOOK.test(middle) && !ASK.test(middle), 'clips 4-5');

    // The specific contradiction this had to survive: the NEVER list is the
    // last thing in lookBlock, and it reads "no begging for likes, no
    // subscribe-style hard sell".
    ok('the preset still forbids the hard sell',
       /no begging for likes, no subscribe-style hard sell/.test(last));
    ok('and the ask says outright that it is not that',
       /This is NOT the hard sell the NEVER list forbids/.test(last));
    ok('so the writer is told the ask is required, not optional',
       /it is required/.test(last));
    ok('and it may break the fourth wall here and nowhere else',
       /allowed to\s+break the fourth wall/.test(last));
}

console.log('\n--- a film whose ends are both in one batch ---');
{
    const one = prompt(ZACK, 1, 0, 1);
    ok('a single-clip film is told both', HOOK.test(one) && ASK.test(one));
    ok('and the hook is listed before the ask',
       one.indexOf('CLIP 1, THE HOOK') < one.indexOf('THE LAST CLIP, THE ASK'));
}

console.log('\n--- presets that declare neither line are untouched ---');
{
    const before = prompt(OTHER, 6, 0, 3);
    ok(`"${OTHER.label}" gets no contract block at all`, !/WHAT MAKES THESE CLIPS DIFFERENT/.test(before));
    ok('and neither line', !HOOK.test(before) && !ASK.test(before));
    ok('while its own direction still reaches the writer',
       !OTHER.direction || /DIRECTION:/.test(before));
    const tail = prompt(OTHER, 6, 3, 6);
    ok('its last batch is untouched too', !/WHAT MAKES THESE CLIPS DIFFERENT/.test(tail));
}

console.log('\n--- a preset that cannot carry one of them ---');
{
    // A sound-led preset narrates clip 1 only, so there is nothing to ask with.
    const intro = prompt({ ...ZACK, narration_scope: 'intro' }, 6, 0, 6);
    ok('an intro-scope preset keeps the hook', HOOK.test(intro));
    ok('but is never given an ask', !ASK.test(intro));

    // A dialogue film has no narrator at all - neither line applies.
    const dialogue = prompt({ ...ZACK, narration_scope: 'dialogue' }, 6, 0, 6);
    ok('a dialogue preset is given neither', !HOOK.test(dialogue) && !ASK.test(dialogue));

    // The direction still reaches a dialogue film, because it is the preset's
    // own text and may describe the look rather than the narration.
    ok('though its direction is still handed over', /DIRECTION:/.test(dialogue));
}

console.log('\n--- the writer is told which clip it is writing ---');
{
    const last = prompt(ZACK, 6, 3, 6);
    // The header counts the film's clips from SCENES (the run's duration), the
    // ask names the clip from the outline it was handed - both are the film's
    // last clip on a real run, where the outline has SCENES beats.
    ok('the batch states its own range', /You are writing clips 4 to 6 of a \d+-clip/.test(last), last.split('\n')[0]);
    ok('the ask block does not name the wrong clip number', !/CLIP 3, THE LAST CLIP/.test(last));
    ok('and a 6-beat outline names clip 6', /CLIP 6, THE LAST CLIP, THE ASK/.test(last));
}

console.log('\n--- what a beat and a line have to DO, not just how long ---');
{
    // The second flat film, and the one this section was added for:
    // stories/the_endless_network_inside_you. Five clips that are one fact made
    // bigger four times - the vessels reach a sports field, then New York and
    // the Grand Canyon, then the Pacific, Japan, Asia and Europe - and clip 1 a
    // summary ("Inside your body lies a continuous thread long enough to
    // encircle the entire Earth multiple times") rather than a hook. The word
    // budgets were all respected. Nothing anywhere said the beat had to be
    // worth a clip, so the safest sentence filled the slot.
    const outlinePrompt = W.castPrompt(ZACK);
    ok('the outline is told every beat needs a NEW surprise',
       /ONE NEW surprise the viewer did not have before/.test(outlinePrompt));
    ok('and that a beat must be concrete, not a general claim',
       /has to be CONCRETE/.test(outlinePrompt));
    ok('the "same fact, bigger area" shape is named and banned',
       /NO BEAT MAY BE THE PREVIOUS BEAT MADE BIGGER/.test(outlinePrompt));
    ok('with the travelogue it produces spelled out as the example',
       /it reaches the street[\s\S]{0,200}it reaches the\s+world/i.test(outlinePrompt));
    ok('and list/tour beats are banned too',
       /No tour beats/.test(outlinePrompt) && /a list of places/.test(outlinePrompt));
    ok('the beats have to escalate',
       /beats ESCALATE/.test(outlinePrompt) && /biggest reveal/.test(outlinePrompt));
    ok('a film may not end on "nobody knows"',
       /Never end on "scientists still do not know"/.test(outlinePrompt));

    // Generic narration rules remain available to presets that do not opt into
    // source-faithful retelling. Zack's replacement is tested separately.
    const lines = prompt({ ...ZACK, source_faithful: false }, 6, 0, 6);
    ok('the writer is told to talk TO the viewer', /Talk TO the viewer, not about the subject/.test(lines));
    ok('one idea per line', /ONE idea per line/.test(lines));
    ok('every line carries something concrete', /Every line carries something CONCRETE/.test(lines));
    ok('restating an earlier line is banned',
       /NEVER restate an earlier clip's line in new words/.test(lines));
    ok('with the delete test for a line that adds nothing',
       /would still make sense with the line\s+deleted/.test(lines));
    ok('the flat openers that produced the example are named',
       /No warm-up phrases/.test(lines) && /Did you know/.test(lines) && /Inside your body lies/.test(lines));
    ok('and a line may not close on a mystery either',
       /remains a\s+mystery/.test(lines));
    ok('the craft block sits with the field specs it applies to',
       lines.indexOf('For EACH clip above') < lines.indexOf('WHAT EACH LINE HAS TO DO'));

    // A dialogue film has no narrator, so none of it applies.
    const dialogue = prompt({ ...ZACK, narration_scope: 'dialogue' }, 6, 0, 6);
    ok('a dialogue preset is not given line rules for a narrator it has not got',
       !/WHAT EACH LINE HAS TO DO/.test(dialogue));
    // Sound-led narrates clip 1 only - and that one line is the hook, so it
    // needs the craft rules as much as a fully narrated film does.
    ok('an intro-scope preset still gets them for its hook',
       /WHAT EACH LINE HAS TO DO/.test(prompt({ ...ZACK, source_faithful: false, narration_scope: 'intro' }, 6, 0, 6)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
