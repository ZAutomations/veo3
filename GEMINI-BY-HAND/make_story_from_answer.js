// Finish a story from ONE pasted AI Studio answer.
//
// write_story.js can already build a story by hand: --print-prompts writes the
// prompt, --from-file reads the answer back. What it cannot do is cope with the
// answer as it actually arrives - the model returns BOTH JSON objects (cast and
// outline, then the clips) in one message, often wrapped in prose or fences, and
// readAnswers() parses one file as one JSON document. So the person doing this by
// hand has to cut the message in two and save the halves under two names.
//
// That is the whole job of this file: take the answer exactly as pasted, find the
// JSON objects in it, work out which is which, save them, and hand them to
// write_story.js. One command instead of three, and nothing to rename.
//
// The title comes from the answer - the prompt asks for the video's own title -
// so nothing has to be typed. --title overrides it, and is required only for an
// answer that has no title in it.
//
//   node make_story_from_answer.js answer.txt --preset relationship-dialogue-real
//   node make_story_from_answer.js answer.txt --title "My Own Title" --preset ...
//
// Anything after the known flags is passed straight through to write_story.js,
// so --duration, --force and the rest still work:
//
//   node make_story_from_answer.js answer.txt --preset ... --duration 80
//
// If the answer holds only call 1 - which is what the two-step route produces -
// it says so and points at --print-prompts for the clip prompt.
//
// Everything in this folder is the by-hand route and nothing else, so the tool
// itself stays out of the way. The tool is still the tool: this calls the real
// write_story.js in the folder above, and produces the same story folder an API
// run would have. HERE is this folder, ROOT is the tool.
//
// Run: node make_story_from_answer.js <file> [--preset <id>] [--title "..."]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const WRITER = path.join(ROOT, 'write_story.js');

function usage(msg) {
    if (msg) console.error(`\n${msg}`);
    console.error('\nUsage: node make_story_from_answer.js <answer-file> [--preset <id>] [--title "..."] [write_story.js flags...]');
    console.error('\n  <answer-file>  the AI Studio reply, saved as text - prose and');
    console.error('                 ```json fences around it are fine.');
    console.error('\n  --title        only to override the video\'s own title, which the');
    console.error('                 answer already carries.');
    process.exit(1);
}

// ── finding the JSON in whatever came back ───────────────────────────────────
// Brace counting, not a regex: the objects are nested several deep and their
// strings contain braces and quotes. Fences are stripped first so a ```json
// wrapper does not become part of the object.
function extractObjects(text) {
    const s = String(text).replace(/```[a-zA-Z]*\r?\n?/g, '\n');
    const out = [];
    for (let i = 0; i < s.length; i++) {
        if (s[i] !== '{') continue;
        let depth = 0, inStr = false, esc = false, end = -1;
        for (let j = i; j < s.length; j++) {
            const c = s[j];
            if (esc) { esc = false; continue; }
            if (inStr && c === '\\') { esc = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === '{') depth++;
            else if (c === '}' && --depth === 0) { end = j; break; }
        }
        if (end < 0) break;
        try {
            const o = JSON.parse(s.slice(i, end + 1));
            // Skipping past the whole object is what stops a nested one being
            // picked up again as if it were an answer of its own.
            if (o && typeof o === 'object' && !Array.isArray(o)) { out.push(o); i = end; }
        } catch { /* not JSON - keep looking from the next brace */ }
    }
    return out;
}

// call 1 answers with the cast and the beats, call 2 with the clips. The key
// that names them is the one the prompt asks for, so it is what is matched on.
// "characters" appears in both, which is why it cannot be the test on its own.
const findMeta = (objs) => objs.find(o => Array.isArray(o.outline)) || null;
const findClips = (objs) => objs.find(o => Array.isArray(o.scenes)) || null;

function main() {
    const argv = process.argv.slice(2);
    const file = argv.find(a => !a.startsWith('--') && /\.(txt|md|json)$/i.test(a));
    if (!file) usage('No answer file given.');
    if (!fs.existsSync(file)) usage(`No such file: ${file}`);
    const flag = (name) => {
        const i = argv.indexOf(name);
        return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
    };
    const PRESET = flag('--preset');

    const objects = extractObjects(fs.readFileSync(file, 'utf8'));
    if (!objects.length) {
        usage(`${path.basename(file)} has no JSON object in it. Save the model's reply as it came, unedited.`);
    }
    const meta = findMeta(objects);
    const clips = findClips(objects);
    if (!meta && !clips) {
        console.error(`\n${path.basename(file)} has JSON in it, but not the JSON this expects.`);
        console.error(`  found keys: ${objects.map(o => Object.keys(o).join('/')).join(' | ')}`);
        console.error('  wanted    : an "outline" (cast and beats) and/or a "scenes" (the clips)');
        process.exit(1);
    }

    // The title. The prompt asks the model for the video's own title, so by hand
    // there is normally nothing to type - --title is only for overriding it.
    // Answers written before the prompt asked for a title have none, and those
    // still need the flag.
    const answerTitle = meta && meta.title ? String(meta.title).trim() : '';
    const TITLE = flag('--title') || answerTitle;
    if (!TITLE) {
        usage(`${path.basename(file)} has no "title" in it, so --title is required - it decides the story folder.`);
    }
    if (!flag('--title')) console.log(`  title  : ${TITLE}  (from the answer)`);
    // --title is stripped here and re-added below, so the resolved title is the
    // only one write_story.js ever sees however it was arrived at.
    const drop = new Set();
    argv.forEach((a, i) => { if (a === '--title') { drop.add(i); drop.add(i + 1); } });
    const pass = argv.filter((a, i) => !drop.has(i) && i !== argv.indexOf(file));

    // The answers are kept beside the file they came from, named after it, so a
    // second film from a second reply cannot overwrite the first one's.
    const stem = path.basename(file).replace(/\.[^.]+$/, '');
    const dir = path.join(HERE, '_answers', stem);
    fs.mkdirSync(dir, { recursive: true });

    const files = [];
    if (meta) {
        const p = path.join(dir, 'answer_1.json');
        fs.writeFileSync(p, JSON.stringify(meta, null, 2) + '\n', 'utf8');
        files.push(p);
        console.log(`  call 1 : ${meta.outline.length} beat(s), ` +
                    `${(meta.characters || []).length} character(s)` +
                    `${meta.place_name ? `, place "${meta.place_name}"` : ''}`);
    }
    if (clips) {
        const p = path.join(dir, 'answer_2.json');
        fs.writeFileSync(p, JSON.stringify(clips, null, 2) + '\n', 'utf8');
        files.push(p);
        console.log(`  call 2 : ${clips.scenes.length} clip(s)`);
    }

    if (!clips) {
        // Only call 1 came back. That is the two-step route, not a failure, so say
        // what the next command is rather than building half a story.
        console.log(`\n  saved  ${path.relative(HERE, files[0])}`);
        console.log('\n  Only call 1 is in this file. Run this for the clip prompt:');
        console.log(`    node write_story.js --title "${TITLE}"` +
                    `${PRESET ? ` --preset ${PRESET}` : ''} --from-file ${path.relative(HERE, files[0])} --print-prompts`);
        console.log('  Then save that answer and pass it to this script again.');
        return;
    }

    const args = [WRITER, '--title', TITLE, ...pass, '--from-file', files[0]];
    if (files[1]) args.push('--from-file', files[1]);
    // cwd is the tool's folder, not this one: write_story.js finds its own files
    // by __dirname, but anything it spawns or prints as a relative path is meant
    // to read from the tool's root.
    const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
    process.exit(r.status == null ? 1 : r.status);
}

module.exports = { extractObjects, findMeta, findClips };

if (require.main === module) main();
