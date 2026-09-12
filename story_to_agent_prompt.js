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
 *
 * Usage:
 *   node story_to_agent_prompt.js <story.json>
 *   node story_to_agent_prompt.js <story.json> --out custom_path.txt
 *   node story_to_agent_prompt.js <story.json> --print      (no file written)
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
// Taken from the story's own veo3_prompt text rather than assumed, so this works
// for a narrated story and does not falsely add the rule to a dialogue-driven one.
const allVp = scenes.map(s => s.veo3_prompt || '').join(' \n ');
const NARRATED = /narrator|voice[\s-]?over|voiceover/i.test(allVp);
const SILENT = /remain silent|mouths closed|no character dialogue|not speaking/i.test(allVp);
// "warm female voice" / "warm male voice" - whatever the story asked for.
const voiceMatch = allVp.match(/(warm|deep|gentle|soft|calm|young|old)?\s*(female|male)\s+voice/i);
const VOICE = voiceMatch ? voiceMatch[0].trim() : null;

// ── assemble -----------------------------------------------------------------
const L = [];
L.push(`Create ${scenes.length} separate clips, one clip per scene, using ${mentionList}, up to 8 seconds each.`);
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
