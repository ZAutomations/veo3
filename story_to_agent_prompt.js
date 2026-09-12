#!/usr/bin/env node
/**
 * STORY JSON -> AGENT MODE PROMPT
 * ================================
 * Builds an Agent Mode prompt file from an existing story JSON.
 *
 * WHY THIS EXISTS: hand-writing the agent prompt loses information. A prompt
 * written by hand for "The Gift of Honesty" dropped the narrator voice-over and
 * the "characters are SILENT, no dialogue" rule that the story JSON specifies,
 * and added character dialogue the story explicitly forbids. The agent then
 * produced exactly that - random visuals with invented dialogue. The story JSON
 * already carries the narration (script_line), the style and the VO rule, so the
 * prompt should be DERIVED from it, never retyped.
 *
 * What it reads from the story JSON:
 *   title, description, style          -> header + STYLE line
 *   scenes[].script_line               -> the narration, read verbatim
 *   scenes[].narrative_context         -> visual brief for the scene
 *   scenes[].characters                -> union becomes the @mention list
 *   scenes[].veo3_prompt               -> scanned for the narrator / silent rules
 *   aspect_ratio, scene_seconds        -> the FORMAT line: clip shape and length
 *
 * Usage:
 *   node story_to_agent_prompt.js <story.json>
 *   node story_to_agent_prompt.js <story.json> --out custom_path.txt
 *   node story_to_agent_prompt.js <story.json> --print      (no file written)
 *   node story_to_agent_prompt.js <story.json> --aspect 9:16 --seconds 6
 *
 * Writes <story_dir>/agent_prompt.txt by default.
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const storyPath = argv.find(a => !a.startsWith('--'));
if (!storyPath) {
    console.error('Usage: node story_to_agent_prompt.js <story.json> [--out file.txt] [--print]');
    process.exit(1);
}
function flag(name, def = null) {
    const i = argv.indexOf(name);
    if (i < 0) return def;
    const v = argv[i + 1];
    return (v && !v.startsWith('--')) ? v : true;
}
const OUT = typeof flag('--out') === 'string' ? flag('--out') : null;
const PRINT_ONLY = !!flag('--print', false);

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

const scenes = story.scenes || [];
if (!scenes.length) {
    console.error('Story has no scenes[].');
    process.exit(1);
}

// ── clip format: aspect ratio and clip length --------------------------------
// Agent Mode has NO settings panel. There is no aspect-ratio dropdown to drive -
// the format is asked for in words, in the prompt, or you get whatever Flow
// defaults to. The first two stories came out 16:9 by luck, not because anything
// requested it, and nothing in this repo mentioned a ratio at all.
//
// Precedence: --aspect / --seconds  >  story JSON  >  the defaults below.
function numFlag(name, def) {
    const v = flag(name);
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}

// Spelled out rather than left as "16:9": the words are what disambiguate
// landscape from portrait if the model only half-reads the ratio.
const ASPECTS = {
    '16:9': '16:9 landscape (widescreen)',
    '9:16': '9:16 portrait (vertical)',
    '1:1': '1:1 square',
};
const aspectArg = flag('--aspect');
const aspectRaw = String(
    typeof aspectArg === 'string' ? aspectArg : (story.aspect_ratio || '16:9')
).trim();
// An unrecognised ratio is passed through as written instead of being silently
// swapped for 16:9 - quietly ignoring what the story asked for is the exact
// failure this line exists to prevent. It is only warned about, because Flow
// adds ratios from time to time and this list cannot know about them.
const ASPECT = ASPECTS[aspectRaw] || null;
const ASPECT_UNKNOWN = !ASPECT;

// 8 s is the documented ceiling for Veo 3.1 - Lite [Lower Priority]. Longer is
// allowed - a different model may take it - but it is called out in the summary,
// because asking the Lite model for 15 s makes it refuse or re-plan the whole
// storyboard rather than fail loudly.
const SECONDS = numFlag('--seconds', Number(story.scene_seconds) || 8);
const SECONDS_OVER = SECONDS > 8;

// ── characters ---------------------------------------------------------------
// Union across all scenes, in first-seen order, keyed lower-case in the JSON
// ("mia") but written capitalised in the prompt ("@Mia").
const charKeys = [];
for (const sc of scenes) {
    for (const c of (sc.characters || [])) {
        const k = String(c).trim();
        if (k && !charKeys.some(x => x.toLowerCase() === k.toLowerCase())) charKeys.push(k);
    }
}
if (!charKeys.length && story.character_references) {
    charKeys.push(...Object.keys(story.character_references));
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const charNames = charKeys.map(cap);
const mentionList = charNames.map(c => '@' + c).join(' and ');

// ── narration / silent-character detection -----------------------------------
// Explicit top-level fields win: `narrated`, `silent_cast`, `narrator_voice`.
// They are unambiguous, and generated stories set them. The prose scan below is
// the fallback for the stories that predate the fields.
//
// The fallback has a real failure mode worth knowing about. It used to read
// veo3_prompt only, so a story carrying script_line - which IS the narration -
// but no veo3_prompt looked un-narrated, the entire voice-over rules block was
// dropped, and the agent invented dialogue. Verified 2026-09-12 by deleting
// veo3_prompt from the Bridge story and watching the block vanish. So the second
// test is for script_line across every scene, which is what narration actually
// looks like, before falling back to prose.
const allVp = scenes.map(s => s.veo3_prompt || '').join(' \n ');
const everySceneNarrated = scenes.length > 0 &&
    scenes.every(s => String(s.script_line || '').trim());
const NARRATED = typeof story.narrated === 'boolean'
    ? story.narrated
    : (everySceneNarrated || /narrator|voice[\s-]?over|voiceover/i.test(allVp));
const SILENT = typeof story.silent_cast === 'boolean'
    ? story.silent_cast
    : /remain silent|mouths closed|no character dialogue|not speaking/i.test(allVp);
// "warm female voice" / "warm male voice" - whatever the story asked for.
const voiceMatch = allVp.match(/(warm|deep|gentle|soft|calm|young|old)?\s*(female|male)\s+voice/i);
const VOICE = (typeof story.narrator_voice === 'string' && story.narrator_voice.trim())
    || (voiceMatch ? voiceMatch[0].trim() : null);

// ── assemble -----------------------------------------------------------------
const L = [];
L.push(`Create ${scenes.length} separate clips, one clip per scene, using ${mentionList}, up to ${SECONDS} seconds each.`);
L.push('');
// Always emitted, narrated or not: the shape of the clip is independent of
// whether the story has a voice-over. "the same ... in every clip" also protects
// the join - concat only copies streams when the clips match, and mixed sizes
// force a re-encode (join_clips.js detects that, but better not to cause it).
L.push(`FORMAT: every clip is ${ASPECT || `${aspectRaw} aspect ratio`}. Keep the same aspect ratio in every clip.`);
L.push('');
L.push(`STORY: "${story.title || 'Untitled'}"`);
if (story.description) L.push(story.description);
if (story.moral) L.push(`Message of the story: ${story.moral}`);
L.push('');

if (NARRATED) {
    L.push('CRITICAL FORMAT - this is a NARRATED STORYTELLING VIDEO, not a dialogue drama:');
    if (SILENT) {
        L.push('- The characters are SILENT. Mouths closed. They never speak and have NO dialogue.');
    } else {
        L.push('- The story is carried by an external narrator, not by character dialogue.');
    }
    L.push(`- Every clip carries an off-screen narrator voice-over${VOICE ? ` (${VOICE})` : ''}, reading`);
    L.push('  that scene\'s NARRATION line below word for word. Do not rewrite or shorten it.');
    L.push('- Documentary storytelling style. The visuals illustrate the narration; they never');
    L.push('  replace it, and no scene may drop its voice-over.');
    L.push(`- Use the SAME narrator voice in every clip so the ${scenes.length} clips sound like one video.`);
    L.push('');
}

if (story.style) {
    L.push(`STYLE: ${story.style}`);
    L.push('');
}

L.push('SCENES:');
L.push('');
let withNarration = 0;
let withVisual = 0;
for (const sc of scenes) {
    const n = sc._scene_number != null ? sc._scene_number : (scenes.indexOf(sc) + 1);
    const title = sc._scene_title ? ` - ${sc._scene_title}` : '';
    const vp = sc.veo3_prompt || '';

    // Narration: script_line is authoritative, but older stories
    // (a_rainy_kindness) predate that field and carry the narration inside
    // veo3_prompt's [AUDIO] tag as  Narrator (V.O., warm male voice): "...".
    // Without this fallback those scenes come out EMPTY and the agent invents
    // the story - which is exactly the bug this converter exists to prevent.
    let narration = sc.script_line ? String(sc.script_line).trim() : '';
    if (!narration) {
        const m = vp.match(/Narrator\s*\([^)]*\)\s*:\s*"([^"]+)"/i);
        if (m) narration = m[1].trim();
    }

    // Visual: narrative_context, or the [SHOT]/[LOOK] sections of veo3_prompt.
    let visual = sc.narrative_context ? String(sc.narrative_context).trim() : '';
    if (!visual) {
        const shot = (vp.match(/\[SHOT\]([\s\S]*?)(?=\[LOOK\]|\[AUDIO\]|$)/i) || [])[1] || '';
        const look = (vp.match(/\[LOOK\]([\s\S]*?)(?=\[AUDIO\]|$)/i) || [])[1] || '';
        visual = `${shot} ${look}`.replace(/\s+/g, ' ').trim();
    }

    L.push(`Scene ${n}${title}`);
    if (narration) {
        withNarration++;
        L.push(`NARRATION (voice-over, read exactly): "${narration}"`);
    } else {
        L.push('NARRATION: (none found in the story JSON for this scene)');
    }
    if (visual) {
        withVisual++;
        L.push(`VISUAL: ${visual}`);
    }
    L.push('');
}

L.push(`Keep ${charNames.join(' and ')} looking exactly as they do in their reference images in every scene.`);
if (NARRATED) {
    L.push('Do not add any character dialogue anywhere - narration only.');
}

const body = L.join('\n');
const outPath = OUT || path.join(path.dirname(storyPath), 'agent_prompt.txt');

if (PRINT_ONLY) {
    console.log(body);
} else {
    fs.writeFileSync(outPath, body, 'utf8');
    console.log(`Wrote ${outPath}`);
}

console.log('');
console.log(`  story      : ${story.title || '(untitled)'}`);
console.log(`  scenes     : ${scenes.length}  ->  ${scenes.length} clips`);
console.log(`  format     : ${ASPECT || `${aspectRaw} aspect ratio (unrecognised)`}`);
if (ASPECT_UNKNOWN) {
    console.log(`               WARNING: "${aspectRaw}" is not one of the known ratios (16:9, 9:16, 1:1).`);
    console.log('               It went into the prompt as written - check the first clip before the rest run.');
}
console.log(`  clip length: ${SECONDS}s${SECONDS_OVER ? '' : ' (Veo 3.1 Lite maximum)'}`);
if (SECONDS_OVER) {
    console.log(`               WARNING: over the 8s ceiling for Veo 3.1 - Lite [Lower Priority]. The agent`);
    console.log('               refuses or re-plans the storyboard rather than failing loudly. Raise this');
    console.log('               only for a model that takes longer clips.');
}
console.log(`  characters : ${charNames.join(', ') || '(none)'}  ->  ${mentionList || '(no mentions)'}`);
console.log(`  narrated   : ${NARRATED ? 'YES - voice-over rules added' : 'no'}`);
console.log(`  narration  : ${withNarration}/${scenes.length} scenes have a line`);
if (withNarration < scenes.length) {
    console.log(`               WARNING: ${scenes.length - withNarration} scene(s) have no narration text.`);
    console.log('               The agent will INVENT those scenes. Add script_line to the story JSON.');
}
console.log(`  visuals    : ${withVisual}/${scenes.length} scenes have a visual brief`);
console.log(`  silent cast: ${SILENT ? 'YES - no-dialogue rule added' : 'no'}`);
console.log(`  narrator   : ${VOICE || (NARRATED ? '(unspecified)' : '-')}`);
console.log(`  style      : ${story.style || '(none in story)'}`);
console.log(`  size       : ${body.length} characters`);
