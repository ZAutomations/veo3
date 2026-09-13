#!/usr/bin/env node
/**
 * STYLE PRESETS - list, inspect, and apply
 * ========================================
 * There are two ways a story gets its look, and they are written in two different
 * places: the `style` field, which story_to_agent_prompt.js emits as the STYLE:
 * line, and `character_descriptions`, which is repeated inside every scene's
 * character block. Both reach the agent. Editing one and not the other leaves the
 * prompt arguing with itself, so --apply keeps an eye on the second one.
 *
 * Usage:
 *   node styles.js --list
 *   node styles.js --show <id>
 *   node styles.js --prompt <id>                  just the STYLE line, to copy
 *   node styles.js --apply <story.json> <id>      rewrite the story's style field
 *   node styles.js --apply <story.json> <id> --dry-run
 *
 * Ids come from styles.json. `--list` prints them.
 */

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const STYLES_FILE = path.join(HERE, 'styles.json');
const argv = process.argv.slice(2);

function flag(name, def = false) {
    const i = argv.indexOf(name);
    if (i < 0) return def;
    const v = argv[i + 1];
    return (v && !v.startsWith('--')) ? v : true;
}
const argAfter = (name) => {
    const i = argv.indexOf(name);
    return i < 0 ? null : argv[i + 1];
};

if (!fs.existsSync(STYLES_FILE)) {
    console.error(`styles.json not found next to this script (${STYLES_FILE})`);
    process.exit(1);
}
const db = JSON.parse(fs.readFileSync(STYLES_FILE, 'utf8'));
const STYLES = db.styles || [];
if (!STYLES.length) {
    console.error('styles.json has no styles[].');
    process.exit(1);
}
const find = (id) => STYLES.find(s => s.id === id);

function usage() {
    console.log('Usage:');
    console.log('  node styles.js --list');
    console.log('  node styles.js --show <id>');
    console.log('  node styles.js --prompt <id>');
    console.log('  node styles.js --apply <story.json> <id> [--dry-run]');
    process.exit(1);
}

// ── --list -------------------------------------------------------------------
if (argv.includes('--list') || !argv.length) {
    const pad = (s, n) => String(s).padEnd(n);
    for (const kind of ['niche', 'art_style']) {
        const group = STYLES.filter(s => s.kind === kind);
        if (!group.length) continue;
        console.log(`\n${kind === 'niche' ? 'CONTENT NICHES' : 'ART STYLES'}  (${group.length})`);
        console.log('-'.repeat(72));
        for (const s of group) console.log(`  ${pad(s.id, 18)} ${s.label}`);
    }
    console.log('\nnode styles.js --show <id>       the full entry');
    console.log('node styles.js --prompt <id>     just the STYLE line');
    process.exit(0);
}

// ── --show / --prompt --------------------------------------------------------
for (const mode of ['--show', '--prompt']) {
    if (!argv.includes(mode)) continue;
    const id = argAfter(mode);
    const s = id && find(id);
    if (!s) {
        console.error(`Unknown style id: ${id || '(none given)'}`);
        console.error(`Known ids: ${STYLES.map(x => x.id).join(', ')}`);
        process.exit(1);
    }
    if (mode === '--prompt') {
        console.log(s.style);
    } else {
        console.log(`\n${s.label}   [${s.kind}]   id: ${s.id}\n`);
        console.log(`  style  (agent prompt STYLE: line)\n    ${s.style}\n`);
        console.log(`  whisk  (image / character-sheet prompts)\n    ${s.whisk}\n`);
        console.log(`  palette\n    ${s.palette}\n`);
        console.log(`  camera\n    ${s.camera}`);
        if (s.audience) console.log(`\n  audience\n    ${s.audience}`);
        // The optional fields. Each is printed only when the preset declares it,
        // so the dump of a preset that declares none is unchanged - and this is
        // described as "the full entry", which it was not: a preset's own length,
        // its cast rules and its sound direction were all invisible here.
        if (s.cast) console.log(`\n  cast\n    ${s.cast}`);
        if (s.cast_types) console.log(`\n  cast types\n    ${s.cast_types.join(', ')}`);
        if (s.default_duration) console.log(`\n  length\n    ${s.default_duration}s by default`);
        if (s.direction) console.log(`\n  direction\n    ${s.direction}`);
        if (s.narration_scope) {
            console.log(`\n  narration scope\n    ${s.narration_scope}` +
                (s.narration_scope === 'intro' ? '  (the opening clip only, then sound-led)' : ''));
        }
        if (s.sound_style) console.log(`\n  sound\n    ${s.sound_style}`);
        console.log('');
    }
    process.exit(0);
}

// ── --apply ------------------------------------------------------------------
if (argv.includes('--apply')) {
    const i = argv.indexOf('--apply');
    const storyPath = argv[i + 1];
    const id = argv[i + 2];
    const dryRun = !!flag('--dry-run', false);

    if (!storyPath || storyPath.startsWith('--') || !id || id.startsWith('--')) usage();
    const preset = find(id);
    if (!preset) {
        console.error(`Unknown style id: ${id}`);
        console.error(`Known ids: ${STYLES.map(x => x.id).join(', ')}`);
        process.exit(1);
    }
    if (!fs.existsSync(storyPath)) {
        console.error(`Story not found: ${storyPath}`);
        process.exit(1);
    }

    let story;
    try {
        story = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
    } catch (e) {
        console.error(`Could not parse ${storyPath}: ${e.message}`);
        process.exit(1);
    }

    const before = story.style || '(none)';
    if (before === preset.style) {
        console.log(`Already set: ${storyPath} already carries the "${preset.label}" style.`);
        process.exit(0);
    }

    console.log(`\nstory  : ${storyPath}`);
    console.log(`preset : ${preset.label}  [${preset.kind}]`);
    console.log(`\nstyle  : ${before}`);
    console.log(`    ->   ${preset.style}`);

    // The trap. `style` is not the only place the look is described: every
    // scene's character block repeats character_descriptions, so a story whose
    // descriptions say "manhwa webtoon" still pulls that way even with a chibi
    // STYLE line. This compares the two by looking for look-describing words in
    // the character text that the new preset does not itself use. It is a
    // heuristic on purpose - it can only ever warn, never rewrite, because
    // editing a cast's identity text automatically would be worse than a
    // mismatch. Silence is not proof the two agree.
    // 'realistic' is deliberately NOT in this list. Every character description in
    // this repo uses it for PROPORTIONS - "realistic adult human proportions",
    // "realistic nose" - never for rendering, so it is present in a hand-painted
    // cast and a photoreal one alike. Including it made the warning fire on every
    // single apply, including bridge -> ghibli where the two agree almost word for
    // word. The signals that survive all name a rendering medium.
    const SIGNALS = [
        'manhwa', 'webtoon', 'watercolour', 'watercolor', 'cel shading', 'hand-painted',
        'hand painted', 'photorealistic', 'live-action', 'live action', '3d', 'cgi',
        'chibi', 'anime', 'cartoon', 'storybook', 'painterly',
        'oil painting', 'claymation', 'pixel art',
    ];
    // These descriptions are BUILT from guard phrases - "NOT photorealistic, NOT
    // 3D CGI, NOT manhwa webtoon" - so a naive substring scan reports the very
    // things the cast is told to avoid. On the first run it flagged six words
    // that were all negations. A warning that is usually wrong gets ignored, so
    // a hit only counts when nothing in the few words before it negates it.
    const NEGATED_BEFORE = /(?:^|[\s(,;:])(?:not|no|never|non|without|avoid|avoiding|rather than)\b[^.;]{0,16}$/i;
    function meaningfullyPresent(text, word) {
        for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
            if (!NEGATED_BEFORE.test(text.slice(Math.max(0, i - 24), i))) return true;
        }
        return false;
    }
    const charText = Object.values(story.character_descriptions || {}).join(' ').toLowerCase();
    const presetText = `${preset.style} ${preset.whisk}`.toLowerCase();
    const leftovers = charText
        ? SIGNALS.filter(w => meaningfullyPresent(charText, w) && !presetText.includes(w))
        : [];

    if (leftovers.length) {
        console.log('');
        console.log('WARNING: character_descriptions still describe a different look.');
        console.log(`  found in the cast text, absent from the new preset: ${leftovers.join(', ')}`);
        console.log('  The STYLE line is not the only place the look is written. Every scene');
        console.log('  repeats the character descriptions, so those still pull toward the old');
        console.log('  look and the two will fight. Rewrite them too - convert_bridge_story.py');
        console.log('  shows the shape they take.');
    }

    if (dryRun) {
        console.log('\n--dry-run: nothing written.\n');
        process.exit(0);
    }

    story.style = preset.style;
    // Written back with the same 2-space indent the rest of the repo uses, so the
    // change shows up in git as one line rather than a whole-file reformat.
    //
    // The line ending has to be preserved too, or "one line" is a lie: these
    // story files are CRLF on disk (Windows, and edited by hand in Notepad),
    // while JSON.stringify only ever emits \n. Writing LF into a CRLF file
    // rewrites every line, so git reports the whole file as changed and the
    // one field you actually edited is invisible in the diff. Copy whichever
    // ending the file already used; default to LF for a file that has none.
    const raw = fs.readFileSync(storyPath, 'utf8');
    const eol = (raw.match(/\r\n/g) || []).length ? '\r\n' : '\n';
    const body = JSON.stringify(story, null, 2).split('\n').join(eol);
    // These files also carry no trailing newline, so adding one would be a bonus
    // changed line at the end of every story in the repo. Match what is there.
    const out = raw.endsWith('\n') ? body + eol : body;
    fs.writeFileSync(storyPath, out, 'utf8');
    console.log(`\nwrote  ${storyPath}`);
    console.log('next   : rebuild the prompt (stage 1) so the new STYLE line reaches the agent.\n');
    process.exit(0);
}

usage();
