// The answer-finder: a model's reply, as pasted, turned into the two answer
// files write_story.js reads.
//
// Why this exists: save-the-reply-as-two-files is the one step of the manual
// route that a person can get wrong in a way nothing notices. The model wraps
// its JSON in prose and fences, sometimes answers both halves in one message,
// sometimes answers only the first - and a reply that is silently misread
// produces a story built from half an answer. So the finding is tested directly
// (fast, and it is the part that can be subtly wrong) and the whole thing once
// through the real CLI, which is what an operator actually runs.
//
// Run: node test_make_story_from_answer.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const M = require('./make_story_from_answer.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + extra : ''}`); }
}

const HERE = __dirname;
// The stories this builds land in the tool's folder, because that is where the
// rest of the pipeline looks for them - the test cleans up after itself.
const ROOT = path.join(HERE, '..');
const STORIES = path.join(ROOT, 'stories');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-answer-'));

// The two shapes the prompt asks for, small enough to read in a failure. The
// title is the video's own, which is what the prompt asks the model for - so the
// answer names the story folder and nothing has to be typed.
const TITLE = 'ZZ Answer Finder Test';
const call1 = {
    title: TITLE,
    description: 'A son stops his mother asking his wife to cook.',
    moral: 'Rest first, guests later.',
    target_audience: 'Families with new babies',
    place_name: 'Kitchen',
    place_description: 'An empty kitchen with a marble island and one tall window.',
    place_prompt: 'One empty kitchen, no people, no text, no labels, no watermark.',
    blocking: 'David is screen-left at the island. Elena is screen-right, facing him.',
    characters: [
        { name: 'David', type: 'human', description: 'Same David throughout - a man in a beige shirt.', sheet_prompt: 'One man, four angles, on a plain neutral grey studio background' },
        { name: 'Elena', type: 'human', description: 'Same Elena throughout - a woman in a cream tunic.', sheet_prompt: 'One woman, four angles, on a plain neutral grey studio background' },
    ],
    outline: [
        { title: 'The Boundary', beat: 'David draws a line about the cooking.' },
        { title: 'The Truce', beat: 'Elena gives in and they cook together.' },
    ],
};
const call2 = {
    scenes: [
        { scene_title: 'The Boundary', dialogue: [{ speaker: 'David', line: 'She gave birth yesterday.' }], narrative_context: 'The kitchen in hard light.', characters: ['david'] },
        { scene_title: 'The Truce', dialogue: [{ speaker: 'Elena', line: 'Then we chop together.' }], narrative_context: 'The kitchen gone soft.', characters: ['david', 'elena'] },
    ],
};

console.log('\nthe answer-finder');

// ── the finding, directly ────────────────────────────────────────────────────
const j1 = JSON.stringify(call1), j2 = JSON.stringify(call2);

ok('an answer with nothing but JSON', M.extractObjects(j1).length === 1);
ok('two objects on two lines', M.extractObjects(`${j1}\n${j2}`).length === 2,
   M.extractObjects(`${j1}\n${j2}`).length);

// The shapes a chat window actually produces. Each of these has to yield the
// same two objects, or the operator is told their good answer is unreadable.
const wrapped = [
    ['fenced', '```json\n' + j1 + '\n```\n\nHere are the clips:\n\n```json\n' + j2 + '\n```'],
    ['prose around it', `Here is part 1:\n\n${j1}\n\nAnd now the clips:\n\n${j2}\n\nLet me know if you want changes.`],
    ['bold labels', `**PART 1**\n${j1}\n\n**PART 2**\n${j2}`],
    ['CRLF', `${j1}\r\n${j2}\r\n`],
];
wrapped.forEach(([name, text]) => {
    const objs = M.extractObjects(text);
    ok(`${name}: both objects found`, objs.length === 2, objs.length);
    ok(`${name}: classified`, !!M.findMeta(objs) && !!M.findClips(objs));
});

// Braces and quotes inside strings are the reason this is a scanner and not a
// regex. A description reading "{{" or a line ending in a backslash used to be
// where a naive parse split the object in half.
const nasty = {
    ...call1,
    description: 'He says "stop" and the JSON looks like {"a":1} to the reader.',
    characters: [{ ...call1.characters[0], description: 'Same David throughout - braces {{ and a trailing backslash \\ inside the text.' }],
};
const nastyObjs = M.extractObjects(`note: {not json}\n${JSON.stringify(nasty)}\n${j2}`);
ok('braces and escapes inside strings survive', nastyObjs.length === 2, nastyObjs.length);
ok('and the description came back whole',
   nastyObjs[0] && nastyObjs[0].description === nasty.description);

// A nested object is not an answer of its own, so it must not be counted twice.
ok('a nested object is not a second answer',
   M.extractObjects('{"a":{"b":{"c":1}},"outline":[]}').length === 1,
   M.extractObjects('{"a":{"b":{"c":1}},"outline":[]}').length);

// Fences with no language, and a fence the model never closed - both happen.
ok('an unclosed fence still yields the object',
   M.extractObjects('```\n' + j1).length === 1);

ok('no JSON at all finds nothing', M.extractObjects('I cannot help with that request.').length === 0);
ok('a truncated object is not an answer', M.extractObjects('{"outline":[{"title":"a"').length === 0);

// "characters" is in both halves, so it cannot decide which is which.
ok('call 1 is found by its outline, not its characters', !!M.findMeta([{ characters: [] }, call1]));
ok('call 2 is found by its scenes', !!M.findClips([call1, call2]));
ok('a scenes answer is not mistaken for call 1', M.findMeta([call2]) === null);

// ── end to end, through the CLI ──────────────────────────────────────────────
const answer = path.join(TMP, 'reply.txt');
fs.writeFileSync(answer, `Here is everything you asked for.\n\n\`\`\`json\n${j1}\n\`\`\`\n\nAnd the clips:\n\n\`\`\`json\n${j2}\n\`\`\`\n`, 'utf8');

// No --title: the answer's own title names the story, which is the whole point -
// the video's title is what the person watching it wants the folder called.
const out = execFileSync(process.execPath,
    [path.join(HERE, 'make_story_from_answer.js'), answer, '--preset', 'relationship-dialogue-real'],
    { cwd: ROOT, encoding: 'utf8' });

ok('it reports both halves', /call 1 : 2 beat\(s\), 2 character\(s\), place "Kitchen"/.test(out), out.split('\n')[2]);
ok('it reports the clips', /call 2 : 2 clip\(s\)/.test(out));
ok('it takes the title from the answer', out.includes(`title  : ${TITLE}  (from the answer)`), out.split('\n')[1]);
ok('it built the story', /wrote .*_story\.json/.test(out));
ok('it wrote the sheets', /wrote .*character_sheets\.txt/.test(out));

const storyDir = path.join(STORIES, 'zz_answer_finder_test');
const storyFile = path.join(storyDir, 'zz_answer_finder_test_story.json');
ok('the story file is where write_story.js puts one', fs.existsSync(storyFile));
if (fs.existsSync(storyFile)) {
    const story = JSON.parse(fs.readFileSync(storyFile, 'utf8'));
    ok('the story is named after the video', story.title === TITLE, story.title);
    ok('two scenes, one per beat', story.scenes.length === 2, story.scenes.length);
    ok('the place reached the shot', story.scenes[0].narrative_context.includes(call1.place_description));
    ok('the dialogue survived', story.scenes[0].dialogue[0].line === 'She gave birth yesterday.');
    ok('it is a dialogue film, not a narrated one', story.narrated === false && story.narration_scope === 'dialogue');
}
const answers = path.join(HERE, '_answers', 'reply');
ok('the answers were kept beside the reply', fs.existsSync(path.join(answers, 'answer_1.json')) &&
   fs.existsSync(path.join(answers, 'answer_2.json')));

// --title still wins when it is given, and must not end up passed twice.
const overrideDir = path.join(STORIES, 'zz_title_override');
const out0 = execFileSync(process.execPath,
    [path.join(HERE, 'make_story_from_answer.js'), answer, '--title', 'ZZ Title Override', '--preset', 'relationship-dialogue-real'],
    { cwd: ROOT, encoding: 'utf8' });
ok('--title overrides the answer\'s title', !/from the answer/.test(out0) &&
   fs.existsSync(path.join(overrideDir, 'zz_title_override_story.json')));

// Call 1 alone is the two-step route, not a failure: it must not build a story,
// and it must print the command that produces the clip prompt.
const half = path.join(TMP, 'half.txt');
fs.writeFileSync(half, j1, 'utf8');
const out2 = execFileSync(process.execPath,
    [path.join(HERE, 'make_story_from_answer.js'), half, '--title', 'ZZ Half Test', '--preset', 'relationship-dialogue-real'],
    { cwd: ROOT, encoding: 'utf8' });
ok('call 1 alone says so', /Only call 1 is in this file/.test(out2));
ok('and prints the clip-prompt command', /--from-file .*answer_1\.json --print-prompts/.test(out2));
ok('and builds nothing', !fs.existsSync(path.join(STORIES, 'zz_half_test')));

// An older answer has no title in it - the prompt only started asking for one
// after the fact - so the flag is still the fallback for those.
const untitled = path.join(TMP, 'untitled.txt');
const { title, ...noTitle } = call1;
fs.writeFileSync(untitled, JSON.stringify(noTitle), 'utf8');
let refused = 0;
try {
    execFileSync(process.execPath,
        [path.join(HERE, 'make_story_from_answer.js'), untitled],
        { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
} catch (e) { refused = e.status; }
ok('an answer with no title and no --title is refused', refused !== 0, refused);

const junk = path.join(TMP, 'junk.txt');
fs.writeFileSync(junk, 'Sorry, I can only help with that if you paste the link.', 'utf8');
let junked = 0;
try {
    execFileSync(process.execPath,
        [path.join(HERE, 'make_story_from_answer.js'), junk, '--title', 'ZZ Junk Test', '--preset', 'relationship-dialogue-real'],
        { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
} catch (e) { junked = e.status; }
ok('an answer with no JSON is refused', junked !== 0, junked);

// ── clean up ─────────────────────────────────────────────────────────────────
for (const d of [storyDir, overrideDir, path.join(HERE, '_answers', 'reply'), path.join(HERE, '_answers', 'half'),
                 path.join(HERE, '_answers', 'untitled'), path.join(HERE, '_answers', 'junk'), TMP]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
