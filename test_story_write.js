// The local half of story writing, driven end to end: buildStory -> validate ->
// writePackage, into a temp folder. No Gemini, no key, nothing sent.
//
// This exists because a one-line scope mistake in writePackage cost a real run
// FOUR MINUTES of API calls and then died with "presetVoice is not defined" -
// after both Gemini calls had already been paid for. `node --check` cannot see
// it (the syntax is fine, the name is simply not in scope) and no test ran
// writePackage at all, so nothing caught it before a live run did.
//
// What is pinned here:
//   - the story records the Flow voice, and a preset with none records nothing
//   - the style bible names it
//   - every scope shape (narrated, intro, dialogue, no cast, no place) survives
//     the whole write path without throwing
//
// Run: node test_story_write.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('./write_story.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + extra : ''}`); }
}

const STYLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'styles.json'), 'utf8')).styles;
const ZACK = STYLES.find((x) => x.id === '3d-zack-style');
const DIALOGUE = STYLES.find((x) => x.narration_scope === 'dialogue');
const VOICELESS = STYLES.find((x) => !x.flow_voice && !x.flow_voices && !x.narration_scope);

const scenesFor = (n) => Array.from({ length: n }, (_, i) => ({
    scene_title: `Beat ${i + 1}`,
    script_line: `Line number ${i + 1}.`,
    sound_context: 'A room tone and a click.',
    narrative_context: 'A slow push in on the object, lit from the left.',
    characters: [],
}));
const metaFor = () => ({
    description: 'A short explainer.',
    target_audience: 'anyone curious',
    moral: 'look closer',
    place_description: 'a clean bright studio with one table',
    blocking: '',
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'story-write-'));

// One full pass down the local half of the pipeline. writePackage names the
// files after the FOLDER, so the temp folder is named like a real one.
function write(preset, { cast = [], scenes = 6 } = {}) {
    const story = W.buildStory(preset, cast, metaFor(), scenesFor(scenes));
    const dir = path.join(tmp(), W.slugify(story.title));
    W.validate(story, cast, preset);
    W.writePackage(dir, preset, story, cast);
    const onDisk = JSON.parse(fs.readFileSync(
        path.join(dir, `${W.slugify(story.title)}_story.json`), 'utf8'));
    const bible = fs.readFileSync(path.join(dir, 'style_bible.md'), 'utf8');
    return { dir, story, onDisk, bible };
}

console.log('\n--- the voice is recorded on the story ---');
{
    const { story, onDisk, bible } = write(ZACK);
    ok('the story carries the preset\'s Flow voice', story.flow_voice === 'Alnilam', story.flow_voice);
    ok('and it reaches the JSON on disk', onDisk.flow_voice === 'Alnilam', onDisk.flow_voice);
    ok('the style bible names it', /\*\*Alnilam\*\*/.test(bible), bible.slice(0, 0));
    ok('as the voice to attach to every clip', /attach it to every clip/.test(bible));
    ok('the narrator description is still there too',
       bible.includes(String(ZACK.narration_voice).slice(0, 40)));
}
{
    // A preset that names no voice must record nothing, so its stories stay
    // exactly as they were before this field existed.
    const v = VOICELESS || { ...ZACK, id: 'no-voice-preset', label: 'No Voice', flow_voice: undefined };
    const { story, bible } = write(v);
    ok(`"${v.label}" records no voice`, story.flow_voice === undefined, story.flow_voice);
    ok('and its bible stays silent about one', !/Flow voice/.test(bible));
}

console.log('\n--- every scope shape survives the write path ---');
{
    // The crash this suite exists for: a name used outside the scope that
    // declared it, reached only after the API calls were already spent.
    let threw = null;
    try { write(ZACK); } catch (e) { threw = e.message; }
    ok('a narrated story writes', threw === null, threw);

    if (DIALOGUE) {
        let d = null;
        try { write(DIALOGUE, { scenes: 6 }); } catch (e) { d = e.message; }
        ok(`a dialogue preset writes ("${DIALOGUE.label}")`, d === null, d);
    } else {
        ok('a dialogue preset writes (none in this file)', true);
    }
    {
        let i = null;
        try { write({ ...ZACK, id: 'intro-shape', narration_scope: 'intro' }); } catch (e) { i = e.message; }
        ok('a sound-led preset writes', i === null, i);
    }
    {
        let n = null;
        try { write({ ...ZACK, id: 'no-place', setting: undefined }); } catch (e) { n = e.message; }
        ok('a story the writer gave no place still writes', n === null, n);
    }
    {
        let c = null;
        try {
            write(ZACK, { cast: [{ name: 'Mira', description: 'a stylised 3D adult woman, plain clothes' }] });
        } catch (e) { c = e.message; }
        ok('a cast story writes', c === null, c);
    }
}

console.log('\n--- the clip contract reaches the finished story ---');
{
    const { story } = write(ZACK);
    ok('clip 1 keeps its own line', String(story.scenes[0].script_line).trim().length > 0);
    ok('every clip has a line', story.scenes.every((s) => String(s.script_line || '').trim().length > 0));
    ok('and the film is marked as narrated', story.narrated === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
