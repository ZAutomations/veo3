// The manual path, driven through the real CLI: prompts out, answers in, story
// folder at the end. No network, no key, nothing sent.
//
// Why this exists: the two writing calls are the only part of the pipeline that
// needs Gemini, and the free API tier is both the smallest model Google has and
// rate-limited per Cloud project. AI Studio gives a person a bigger model for
// nothing, so the calls can be made by hand instead - but only if the hand-made
// answer lands in exactly the same place an API answer does.
//
// It is driven through the CLI and not through the helpers on purpose. What has
// to hold is that `--print-prompts` and `--from-file` compose into a working run
// with the arguments printed on screen, because that is what an operator pastes.
// A previous one-line scope mistake in this file cost a real four-minute API run
// and died at the end of it; a suite that calls the internals directly would not
// have caught that either.
//
// Run: node test_manual_story.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const W = require('./write_story.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + extra : ''}`); }
}

const HERE = __dirname;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-manual-'));
const STYLES = JSON.parse(fs.readFileSync(path.join(HERE, 'styles.json'), 'utf8')).styles;
const ZACK = STYLES.find((x) => x.id === '3d-zack-style');

// The clip a manual answer has to look like: the film's place named in the
// narrative_context, a narrated line inside the word budget, one cast member.
const PLACE = String(ZACK.setting || 'a clean bright studio with one table');
const clip = (n) => ({
    scene_title: `Beat ${n}`,
    script_line: `This is line number ${n} and it lands.`,
    narrative_context: `A slow push in on the table in ${PLACE}, lit from the left.`,
    characters: ['mira'],
});
const beat = (n) => ({ title: `Beat ${n}`, beat: `Something new happens in beat ${n}.` });
const call1 = (beats) => ({
    description: 'A short explainer about a thing nobody looks at twice.',
    moral: 'look closer',
    target_audience: 'anyone curious',
    place_description: PLACE,
    characters: [{ name: 'Mira', description: 'a stylised 3D woman in plain clothes' }],
    outline: Array.from({ length: beats }, (_, i) => beat(i + 1)),
});

// Every run goes through the CLI, so every argument is one an operator could
// have typed. --no-house-cast keeps house_cast.json out of it: that file is a
// real thing on a working machine and would change the cast under the test.
function run(args, opts = {}) {
    try {
        const out = execFileSync(process.execPath, [path.join(HERE, 'write_story.js'), ...args],
            { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, out, err: '' };
    } catch (e) {
        return {
            ok: false,
            out: String(e.stdout || ''),
            err: String(e.stderr || e.message || ''),
            status: e.status,
        };
    }
}
const read = (p) => fs.readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));
const save = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');

console.log('\n--- reading an answer file the way a chat window produces one ---');
{
    const f = (name, text) => {
        const p = path.join(TMP, name);
        fs.writeFileSync(p, text, 'utf8');
        return p;
    };
    // Fenced, because that is what a chat window returns when asked for JSON.
    const fenced = f('fenced.json', '```json\n' + JSON.stringify({ moral: 'm', outline: [beat(1)] }) + '\n```');
    const a1 = W.readAnswers([fenced]);
    ok('a fenced reply is read', a1.answers.moral === 'm' && a1.answers.outline.length === 1, JSON.stringify(a1.answers));

    // Call 2's answer IS the bare array. It must not be refused for having no key.
    const bare = f('bare.json', JSON.stringify([clip(1), clip(2)]));
    ok('a bare array is the scenes', W.readAnswers([bare]).scenes.length === 2);
    ok('and it leaves meta alone', Object.keys(W.readAnswers([bare]).answers).length === 0);

    // Two files, one answer each - the normal manual run.
    const two = W.readAnswers([fenced, bare]);
    ok('two answer files merge', two.answers.moral === 'm' && two.scenes.length === 2);

    // Both answers in one file, each under its own key.
    const wrapped = f('wrapped.json', JSON.stringify({ answer1: { moral: 'm', outline: [beat(1)] }, answer2: { scenes: [clip(1)] } }));
    const w = W.readAnswers([wrapped]);
    ok('answers under their own keys are found', w.answers.moral === 'm' && w.scenes.length === 1, JSON.stringify(w.scenes && w.scenes.length));

    // Two batches are two answers. They are clips 1-6 and 7-8, so the second
    // must ADD to the first - replacing it would silently write six clips of an
    // eight-clip film and never mention it.
    const b1 = f('b1.json', JSON.stringify({ scenes: [clip(1), clip(2)] }));
    const b2 = f('b2.json', JSON.stringify({ scenes: [clip(3)] }));
    const batched = W.readAnswers([b1, b2]);
    ok('a second batch is appended, not substituted', batched.scenes.length === 3, String(batched.scenes.length));
    ok('and in the order the files were given', batched.scenes.map(s => s.scene_title).join(',') === 'Beat 1,Beat 2,Beat 3');

    // Alternate keys, and a nested place that is NOT an answer.
    const alt = f('alt.json', JSON.stringify({ clips: [clip(1)], place: { name: 'Studio', description: 'x' } }));
    const al = W.readAnswers([alt]);
    ok('"clips" is accepted as the scenes', al.scenes.length === 1);
    ok('and a nested place does not scatter its fields over the story',
       al.answers.name === undefined && al.answers.description === undefined,
       JSON.stringify(al.answers));

    const noObj = f('nope.json', 'I could not do that, sorry.');
    let threw = null;
    try { W.readAnswers([noObj]); } catch (e) { threw = e.message; }
    ok('a file with no JSON in it says which file', !!threw && /nope\.json/.test(threw), threw);

    let missing = null;
    try { W.readAnswers([path.join(TMP, 'does_not_exist.json')]); } catch (e) { missing = e.message; }
    ok('a file that is not there says so', !!missing && /could not read/.test(missing), missing);
}

console.log('\n--- the meta it hands the story builder ---');
{
    const m = W.metaFrom({ description: ' d ', moral: 'm', target_audience: null, outline: [beat(1)] });
    ok('strings are trimmed', m.description === 'd');
    ok('a missing field is an empty string, not undefined', m.target_audience === '');
    ok('the outline survives', m.outline.length === 1);
    ok('and so does the cast', W.metaFrom({ characters: [{ name: 'Mira' }] }).characters.length === 1);
    ok('a file with no characters/cast yields empty lists, not crashes',
       W.metaFrom({}).characters.length === 0 && W.metaFrom({}).outline.length === 0);
}

console.log('\n--- the recipe the operator follows ---');
{
    const first = W.howToText(ZACK, 'A Title', {});
    ok('the first recipe says to save answer 1', /prompts\/answer_1\.json/.test(first));
    ok('and names the prompt file it just wrote', /1_cast_and_outline\.txt/.test(first));
    ok('with the command that produces the clip prompt',
       /--from-file prompts\/answer_1\.json --print-prompts/.test(first));
    ok('and the title and preset already filled in',
       first.includes('--title "A Title"') && first.includes(`--preset ${ZACK.id}`));
    ok('it does not tell the operator to write the folder yet', !/writes the folder/.test(first));

    // `next` is a bare file name: howToText prefixes the story folder itself, so
    // the printed command works from the tool's folder rather than only from
    // inside the story folder.
    const later = W.howToText(ZACK, 'A Title', {
        have: ['prompts/answer_1.json'],
        promptFile: '2_clips_1-6.txt',
        next: 'answer_2_clips_1-6.json',
    });
    ok('the later recipe names the clip prompt', /prompts\/2_clips_1-6\.txt/.test(later));
    ok('and the file its answer belongs in', /prompts\/answer_2_clips_1-6\.json/.test(later));
    ok('and says the batch prompts come one at a time, with the reason',
       /Each\s+prompt is written only after the answers before it exist/.test(later) &&
       /shown the clips that came before it/.test(later));
    ok('both files it has so far are in the printed command',
       /--from-file prompts\/answer_1\.json --from-file prompts\/answer_2_clips_1-6\.json/.test(later), later);
    ok('and the closing command is the same run without --print-prompts',
       /--from-file prompts\/answer_1\.json --from-file prompts\/answer_2_clips_1-6\.json\n/.test(later) &&
       /without --print-prompts/.test(later));
    ok('it promises nothing is sent', /Nothing is ever sent/.test(later));

    // The story folder the prompts live in, spelled so the command can be run
    // from the tool's own folder - which is where the recipe says to run it.
    const elsewhere = W.howToText(ZACK, 'A Title', {
        dir: path.join(HERE, 'stories', 'a_slug'),
        promptFile: '2_clips_1-6.txt',
        next: 'answer_2_clips_1-6.json',
        have: ['stories/a_slug/prompts/answer_1.json'],
    });
    ok('the paths are relative to the tool folder',
       /stories\/a_slug\/prompts\/answer_2_clips_1-6\.json/.test(elsewhere) &&
       !/prompts\/prompts\//.test(elsewhere), elsewhere.split('\n').slice(-8).join('\n'));
}

console.log('\n--- a film that fits in one batch, end to end ---');
{
    const dir = path.join(TMP, 'one_batch');
    const base = ['--title', 'One Batch', '--preset', ZACK.id, '--no-house-cast',
                  '--duration', '48', '--seconds', '8', '--out', dir];

    // 1. the prompts, with no key at all
    const step1 = run([...base, '--print-prompts']);
    ok('step 1 runs with no API key', step1.ok, step1.err.slice(-400));
    const castPromptFile = path.join(dir, 'prompts', '1_cast_and_outline.txt');
    ok('call 1\'s prompt is on disk', fs.existsSync(castPromptFile));
    ok('and it is call 1\'s prompt', /outline/.test(read(castPromptFile)) && /cast/.test(read(castPromptFile)));
    ok('with a recipe beside it', fs.existsSync(path.join(dir, 'prompts', 'HOWTO.txt')));
    ok('and no key was asked for', !/No API key/.test(step1.out + step1.err));

    // 2. the answer, saved the way the recipe says
    save(path.join(dir, 'prompts', 'answer_1.json'), call1(6));

    // 3. the clip prompt
    const step3 = run([...base, '--from-file', path.join(dir, 'prompts', 'answer_1.json'), '--print-prompts']);
    ok('step 3 runs', step3.ok, step3.err.slice(-400));
    const clipPromptFile = path.join(dir, 'prompts', '2_clips_1-6.txt');
    ok('the clip prompt is written', fs.existsSync(clipPromptFile));
    ok('it covers the whole film in one batch', /clips 1 to 6/.test(read(clipPromptFile)), read(clipPromptFile).split('\n')[0]);
    ok('it carries the cast from answer 1', /Mira/.test(read(clipPromptFile)));
    ok('and the beats from answer 1', /Something new happens in beat 3/.test(read(clipPromptFile)));
    ok('it does NOT write a story yet', !fs.existsSync(path.join(dir, 'one_batch_story.json')));
    ok('and it does not pretend the film is finished', !/wrote  .*_story\.json/.test(step3.out));

    // 4. the clip answer, then the story
    save(path.join(dir, 'prompts', 'answer_2_clips_1-6.json'), { scenes: [1, 2, 3, 4, 5, 6].map(clip) });
    const last = run([...base,
        '--from-file', path.join(dir, 'prompts', 'answer_1.json'),
        '--from-file', path.join(dir, 'prompts', 'answer_2_clips_1-6.json')]);
    ok('the closing run writes the story', last.ok, last.err.slice(-600));

    const storyFile = path.join(dir, 'one_batch_story.json');
    ok('the story JSON is in the folder', fs.existsSync(storyFile));
    const story = readJson(storyFile);
    ok('with every clip in it', story.scenes.length === 6, String(story.scenes.length));
    ok('narrated, as this preset is', story.narrated === true);
    ok('the Flow voice is recorded from the preset', story.flow_voice === 'Alnilam', story.flow_voice);
    ok('the cast came through', Object.keys(story.character_descriptions).join(',') === 'mira',
       Object.keys(story.character_descriptions).join(','));
    ok('each clip kept the line the answer gave it',
       story.scenes.every((s, i) => s.script_line === clip(i + 1).script_line));
    ok('and no scene was invented', story.scenes.length === 6);
    ok('the style bible is written too', fs.existsSync(path.join(dir, 'style_bible.md')));
    ok('and the sheets file for the cast', fs.existsSync(path.join(dir, 'character_sheets.txt')));
}

console.log('\n--- a film that needs two batches ---');
{
    const dir = path.join(TMP, 'two_batch');
    const base = ['--title', 'Two Batch', '--preset', ZACK.id, '--no-house-cast',
                  '--duration', '64', '--seconds', '8', '--out', dir];
    const a1 = path.join(dir, 'prompts', 'answer_1.json');

    run([...base, '--print-prompts']);
    save(a1, call1(8));

    // Batch 1 of 2
    const s1 = run([...base, '--from-file', a1, '--print-prompts']);
    ok('the first clip prompt is written', fs.existsSync(path.join(dir, 'prompts', '2_clips_1-6.txt')), s1.err.slice(-300));
    ok('and it is not the whole film', !fs.existsSync(path.join(dir, 'prompts', '2_clips_7-8.txt')));
    save(path.join(dir, 'prompts', 'answer_2_clips_1-6.json'), { scenes: [1, 2, 3, 4, 5, 6].map(clip) });

    // Batch 2 of 2, which can only be written now - it is shown clips 1-6
    const s2 = run([...base, '--from-file', a1, '--from-file', path.join(dir, 'prompts', 'answer_2_clips_1-6.json'), '--print-prompts']);
    ok('the second clip prompt is written', fs.existsSync(path.join(dir, 'prompts', '2_clips_7-8.txt')), s2.err.slice(-300));
    ok('it asks for clips 7 to 8 only', /clips 7 to 8/.test(read(path.join(dir, 'prompts', '2_clips_7-8.txt'))));
    ok('and it is shown the line before it, so it cannot repeat it',
       /This is line number 6 and it lands/.test(read(path.join(dir, 'prompts', '2_clips_7-8.txt'))));
    ok('no story has been written yet', !fs.existsSync(path.join(dir, 'two_batch_story.json')));
    save(path.join(dir, 'prompts', 'answer_2_clips_7-8.json'), { scenes: [clip(7), clip(8)] });

    const last = run([...base, '--from-file', a1,
        '--from-file', path.join(dir, 'prompts', 'answer_2_clips_1-6.json'),
        '--from-file', path.join(dir, 'prompts', 'answer_2_clips_7-8.json')]);
    ok('the story is written once the clips are complete', last.ok, last.err.slice(-600));
    const story = readJson(path.join(dir, 'two_batch_story.json'));
    ok('all eight clips are in it, in order', story.scenes.length === 8, String(story.scenes.length));
    ok('and the second batch is at the end, not the top',
       story.scenes[6].script_line === clip(7).script_line && story.scenes[7].script_line === clip(8).script_line);
    ok('every clip has a line', story.scenes.every((s) => String(s.script_line || '').trim().length > 0));
}

console.log('\n--- saying what is wrong, rather than writing a bad story ---');
{
    const dir = path.join(TMP, 'complaints');
    const base = ['--title', 'Complaints', '--preset', ZACK.id, '--no-house-cast',
                  '--duration', '48', '--seconds', '8', '--out', dir];
    const a1 = path.join(dir, 'prompts', 'answer_1.json');
    run([...base, '--print-prompts']);
    save(a1, call1(6));

    // Clips only, no call 1 - the outline is missing, so there is nothing to
    // write clips against.
    const clipsOnly = path.join(TMP, 'clips_only.json');
    save(clipsOnly, { scenes: [1, 2, 3, 4, 5, 6].map(clip) });
    const noOutline = run([...base, '--from-file', clipsOnly]);
    ok('a file with clips but no outline is refused', !noOutline.ok);
    ok('and it names what is missing', /no "outline"/.test(noOutline.err), noOutline.err.slice(-300));
    ok('and points at the recipe', /HOWTO\.txt/.test(noOutline.err));

    // Call 1's answer alone, with no --print-prompts: the next step is not
    // guessed at, it is named.
    const noFlag = run([...base, '--from-file', a1]);
    ok('an unfinished manual run without --print-prompts is refused', !noFlag.ok);
    ok('and says which flag writes the next prompt', /--print-prompts/.test(noFlag.err), noFlag.err.slice(-300));
    ok('and how many clips it is short', /0 of the 6 clip/.test(noFlag.err), noFlag.err.slice(-300));

    // A preset that REQUIRES a cast cannot be papered over with an answer that
    // names nobody. (3d-zack-style is cast:"optional", where an empty cast is a
    // legitimate answer rather than a missing one - so this needs its own preset,
    // and ghibli is required-cast.)
    const REQUIRED = STYLES.find((x) => x.cast === 'required');
    const noCast = path.join(TMP, 'no_cast.json');
    const bare = call1(6); delete bare.characters;
    save(noCast, bare);
    const noCastRun = run(['--title', 'No Cast', '--preset', REQUIRED.id, '--no-house-cast',
        '--duration', '48', '--seconds', '8', '--out', path.join(dir, 'nocast'),
        '--from-file', noCast, '--print-prompts']);
    ok(`an answer with no cast is refused by a preset that needs one (${REQUIRED.id})`, !noCastRun.ok,
       (noCastRun.out || '').slice(-200));
    ok('and it says to save call 1\'s answer, not only the clips',
       /save call 1's answer/.test(noCastRun.err), noCastRun.err.slice(-300));

    // The same answer against an optional-cast preset is NOT an error - the
    // blank cast is the answer, and the film is about the world instead.
    const optional = run([...base, '--from-file', noCast, '--print-prompts']);
    ok('the same answer is accepted by a preset whose cast is optional', optional.ok,
       optional.err.slice(-300));

    // Nothing above wrote a story.
    ok('not one of those wrote a story folder',
       !fs.existsSync(path.join(dir, 'complaints_story.json')));
}

console.log('\n--- the API path is untouched by any of this ---');
{
    const src = fs.readFileSync(path.join(HERE, 'write_story.js'), 'utf8');
    // The key is demanded of the API transport and of that one only: a run by
    // hand has its answers already, and a run through AI Studio needs no key -
    // saying "no API key" over either would be wrong twice.
    ok('a run with no --from-file still needs a key',
       /if \(!manual && TRANSPORT !== 'web' && !ring\.size\)/.test(src));
    ok('and the web transport is exempt from it', /TRANSPORT !== 'web'/.test(src));
    ok('the API calls are still there', /await ask\(ring, MODELS, castPrompt\(p, houseCast\), 8192\)/.test(src));
    ok('and so is the batch loop for them', /await ask\(ring, chain, scenesPrompt\(/.test(src));
    ok('the story is still built the same way for both', /const story = buildStory\(p, cast, meta, scenes\)/.test(src));
    ok('--dry-run is still the console version', /--dry-run: prompts only, nothing sent and nothing written/.test(src));
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
