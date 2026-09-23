#!/usr/bin/env node
/**
 * EXTEND PROMPTS - what to type into "What happens next?"
 * =======================================================
 * The Scenes/Ingredients route makes clip 1 from the character sheets and then
 * gets every later clip by arming Extend (Veo 3.1 - Lite) in the editor
 * timeline, which carries the previous clip's LAST FRAME forward. That carried
 * frame is the whole point of the route: no re-staging, no drift, no cut.
 *
 * THE PROBLEM. A story written for standalone clips gives every scene a prompt
 * that re-establishes the film from nothing:
 *
 *   [SHOT] <the entire room, verbatim> SPATIAL BLOCKING (LOCKED): <the whole
 *   rule - fixed sides, fixed wardrobe, never cross the axis> <this scene's
 *   staging> The camera is a wide two-shot at eye level, both in frame.
 *   [LOOK] <the film's photographic style>
 *   [AUDIO] <the lines>
 *
 * Measured on stories/the_price_of_obligation, that opening block is 895
 * characters long and IDENTICAL in all 14 scenes, and every scene closes with
 * an explicit camera direction. Typed into an extend box, that text does not
 * describe what happens next - it describes a new shot, and asks for a
 * specific frame ("wide two-shot at eye level"). The model is being told to set
 * the shot up again at the exact moment we want it to keep rolling, which is
 * how an extend chain comes back looking like cuts.
 *
 * WHAT THIS DOES. Extend needs the opposite: what the carried frame cannot
 * already tell the model. The room, the wardrobe, the blocking rule, the light
 * and the lens are all IN the last frame, so they are dropped. What is left is
 * the one thing the frame cannot know - this scene's own action - plus the
 * lines. The undifferentiated block is found rather than guessed at: it is the
 * longest PREFIX every scene's [SHOT] shares, which survives preset edits and
 * the story drifting away from the preset that wrote it (both of which have
 * already happened to this story - its stored `blocking` field no longer
 * matches the text baked into its own prompts).
 *
 * Clip 1 is NOT included: it is the establishing clip, so it should describe
 * the film from nothing, exactly as written.
 *
 * WHAT IT WRITES. extend_prompts.json beside the story, keyed by scene number.
 * veo3_flow_new_ui.js reads it if it is there and uses it for the extends
 * instead of the scene's own veo3_prompt. Delete the file and the engine goes
 * back to the story's prompts - that is the whole rollback. The story JSON is
 * never touched.
 *
 * Usage:
 *   node extend_prompts.js stories/the_price_of_obligation --to 5
 *   node extend_prompts.js stories/the_price_of_obligation --to 5 --write
 *
 *   --to N       only cover scenes 2..N (default: every scene after the first)
 *   --write      write extend_prompts.json (default is a dry run)
 *
 * The derivation is exported so it can be tested without a browser, a story
 * file or a network - see test_extend_prompts.js.
 */

const fs = require('fs');
const path = require('path');
const { resolveStoryJson } = require('./order_clips_by_dialogue.js');

function ts() { return new Date().toTimeString().slice(0, 8); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function banner(msg) { console.log(`\n${'='.repeat(70)}\n${msg}\n${'='.repeat(70)}`); }

// The one line that is added. Everything else is the story's own words. It has
// to be explicit because the extend box is a blank slate: Flow will happily
// read a bare action sentence as a fresh scene brief.
const CONTINUE_LINE = 'Continue the same shot from the previous clip without cutting - '
    + 'same framing, same lighting, same positions.';

// ── reading a veo3_prompt apart ──────────────────────────────────────────────
// A prompt is [SHOT] body \n[LOOK] style \n[AUDIO] lines. Both markers are
// present in every scene of every story built by write_story.js, but the splits
// are chained so a prompt missing one still yields its body.
function sceneBody(veo3_prompt) {
    return String(veo3_prompt || '')
        .replace(/^\[SHOT\]\s*/i, '')
        .split(/\n\[LOOK\]/)[0]
        .split(/\n\[AUDIO\]/)[0]
        .replace(/\s+/g, ' ')
        .trim();
}
// The spoken lines, verbatim. These are NOT rewritten: they are the scene's
// dialogue, and they are also what lets order_clips_by_dialogue.js recognise
// the finished clip by ear.
function audioPart(veo3_prompt) {
    const t = String(veo3_prompt || '');
    const i = t.lastIndexOf('\n[AUDIO] ');
    return i < 0 ? '' : t.slice(i + '\n[AUDIO] '.length).trim();
}

// ── finding the part every scene repeats ─────────────────────────────────────
function sharedPrefix(strings) {
    if (!strings.length) return '';
    return strings.reduce((a, b) => {
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return a.slice(0, i);
    });
}
// Cut the shared run back to its last sentence end, so the block that gets
// removed is whole sentences and never half a word. End-of-string counts as a
// sentence end - a run that finishes on a full stop has finished a sentence,
// and without that the last sentence of the shared block was left in place and
// re-typed into every extend.
function wholeSentences(s) {
    const m = String(s || '').match(/^[\s\S]*[.!?](?:\s|$)/);
    return m ? m[0] : null;
}
// An explicit camera direction is the clearest "set up a new shot" signal in
// the prompt, and a wide two-shot is not the frame the clip is already on.
const stripCamera = (t) => String(t || '').replace(/\s*The camera is [^.]*\.\s*$/i, '').trim();

// How much of a scene is its own. Below this the shared block is too small to
// be the re-establishing text, and subtracting it would be guesswork.
const MIN_BLOCK = 100;

// Scenes 2..N as extend prompts, or a refusal saying why not.
function deriveExtendPrompts(story, toScene) {
    const scenes = (story && Array.isArray(story.scenes)) ? story.scenes : [];
    if (scenes.length < 2) return { ok: false, reason: 'the story has fewer than two scenes' };

    const bodies = scenes.map(s => sceneBody(s.veo3_prompt));
    const blank = bodies.findIndex(b => !b);
    if (blank >= 0) return { ok: false, reason: `scene ${blank + 1} has no [SHOT] text to work from` };

    // Everything the scenes agree on, word for word, from the start. This is
    // the room plus the blocking rule - the text the carried frame already
    // contains.
    const block = wholeSentences(sharedPrefix(bodies));
    if (!block || block.trim().length < MIN_BLOCK) {
        return {
            ok: false,
            reason: 'the scenes do not share a long enough opening block to subtract, so there is '
                + 'no reliable way to tell this scene\'s own action from the film\'s standing text',
        };
    }

    const prompts = {};
    const skipped = [];
    for (let i = 1; i < scenes.length; i++) {
        const num = i + 1;
        if (toScene && num > toScene) break;
        const action = stripCamera(bodies[i].slice(block.length).trim());
        if (!action) { skipped.push(num); continue; }
        const audio = audioPart(scenes[i].veo3_prompt);
        prompts[num] = CONTINUE_LINE + '\n' + action + (audio ? `\n[AUDIO] ${audio}` : '');
    }
    if (!Object.keys(prompts).length) {
        return { ok: false, reason: 'no scene had any action left after subtracting the shared block' };
    }
    return { ok: true, block: block.trim(), prompts, skipped };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function main() {
    const argv = process.argv.slice(2);
    function flag(name, def = null) {
        const i = argv.indexOf(name);
        if (i < 0) return def;
        const v = argv[i + 1];
        return (v && !v.startsWith('--')) ? v : true;
    }
    const TARGET = argv.find(a => !a.startsWith('--'));
    if (!TARGET) {
        console.error('Usage: node extend_prompts.js <story_json_or_folder> [--to N] [--write]');
        process.exit(1);
    }
    const WRITE = !!flag('--write', false);
    const TO = Number(flag('--to', 0)) || 0;

    const STORY_JSON = resolveStoryJson(TARGET);
    if (!STORY_JSON) {
        console.error(`Not a story JSON or a folder holding one: ${TARGET}`);
        process.exit(1);
    }
    const story = JSON.parse(fs.readFileSync(STORY_JSON, 'utf8'));

    banner('EXTEND PROMPTS');
    log(`Story : ${path.relative(process.cwd(), STORY_JSON)}`);
    log(`Scenes: ${(story.scenes || []).length}${TO ? `  (covering 2-${TO})` : ''}`);

    const r = deriveExtendPrompts(story, TO);
    if (!r.ok) {
        console.error(`\nCannot derive extend prompts: ${r.reason}.`);
        console.error('The extends would fall back to the scene prompts in the story, which');
        console.error('re-establish the film instead of continuing it. Fix the story, or write');
        console.error('the extend text by hand into extend_prompts.json.');
        process.exit(1);
    }

    console.log('');
    log(`Dropped from every scene (${r.block.length} chars, identical in all of them):`);
    console.log(`  ${r.block.slice(0, 300)}${r.block.length > 300 ? ' ...' : ''}`);
    if (r.skipped.length) {
        log(`WARNING: no action left for scene(s) ${r.skipped.join(', ')} - they keep the story's own prompt`);
    }
    console.log('');
    for (const num of Object.keys(r.prompts).map(Number).sort((a, b) => a - b)) {
        console.log(`── scene ${num} ${'─'.repeat(56)}`);
        console.log(r.prompts[num]);
        console.log('');
    }

    const OUT = path.join(path.dirname(STORY_JSON), 'extend_prompts.json');
    if (!WRITE) {
        log('--dry run: nothing written. Re-run with --write to save these, which the');
        log('extend engine then picks up by itself. Clip 1 is not included - it is the');
        log('establishing clip and keeps the story\'s own prompt.');
        return;
    }
    fs.writeFileSync(OUT, JSON.stringify({
        note: 'Prompt per scene for the EXTEND route (scenes 2+). Clip 1 is the establishing '
            + 'clip and uses the story\'s own veo3_prompt. The film\'s standing text (room, '
            + 'blocking rule, look, camera) is deliberately absent: the extended frame already '
            + 'carries it, and repeating it makes the model re-stage the shot instead of '
            + 'continuing it. Delete this file to fall back to the story\'s prompts.',
        derivedFrom: path.basename(STORY_JSON),
        droppedBlock: r.block,
        prompts: r.prompts,
    }, null, 2));
    log(`Wrote ${path.relative(process.cwd(), OUT)}  (${Object.keys(r.prompts).length} prompt(s))`);
    console.log('');
    log('Next:  node veo3_flow_new_ui.js <story.json> --from 1 --to '
        + `${TO || (story.scenes || []).length} --project-url <project> --cdp 9222`);
}

if (require.main === module) main();

module.exports = {
    CONTINUE_LINE, sceneBody, audioPart, sharedPrefix, wholeSentences, stripCamera,
    deriveExtendPrompts,
};
