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
 *   scenes[].sound_context             -> the sound brief for a clip with no narration
 *   scenes[].dialogue                  -> [{speaker, line}] for a spoken dialogue story
 *   scenes[].narrative_context         -> visual brief for the scene
 *   scenes[].characters                -> union becomes the @mention list, and
 *                                         each scene names who is actually in it
 *   place.name                         -> a third @mention, for the place plate
 *   place.description                  -> the PLACE block, and repeated per scene
 *                                         through narrative_context
 *   blocking                           -> the BLOCKING block: where the two of
 *                                         them physically are for the whole film.
 *                                         Also already inside every scene's
 *                                         visual line, verbatim, because
 *                                         write_story.js puts it there
 *   character_descriptions             -> the CAST block, and repeated per scene
 *   scenes[].veo3_prompt               -> scanned for the narrator / silent rules
 *   aspect_ratio, scene_seconds        -> the FORMAT line: clip shape and length
 *
 * Usage:
 *   node story_to_agent_prompt.js <story.json>
 *   node story_to_agent_prompt.js <story.json> --out custom_path.txt
 *   node story_to_agent_prompt.js <story.json> --print      (no file written)
 *   node story_to_agent_prompt.js <story.json> --aspect 9:16 --seconds 6
 *   node story_to_agent_prompt.js <story.json> --aspect flow    (default: the
 *       ratio is set in Flow's Settings menu, and the prompt says nothing)
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
// Agent Mode's CLIP SHAPE is set in Flow's own Settings menu (the tune icon
// beside the prompt box: model, aspect ratio, frames), NOT by the words in the
// prompt. Asking for "16:9 landscape" in the text did nothing while that menu
// was still set to vertical - which is why the tool asked for landscape and
// still got portrait. The default here is therefore "Flow": the prompt says
// nothing about the ratio and the creator sets it in Flow. A real ratio can
// still be passed and is written into the prompt, for anyone who wants the tool
// to request one.
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
    typeof aspectArg === 'string' ? aspectArg : (story.aspect_ratio || 'Flow')
).trim();
// "Flow" (also auto / default / none / blank) means the ratio is NOT ours to
// impose - it is set in Flow's Settings menu and the prompt stays quiet about
// it. Anything else is spelled out in the prompt as before.
const AUTO_RATIO = !aspectRaw || /^(auto|flow|default|none)$/i.test(aspectRaw);
// An unrecognised ratio is passed through as written instead of being silently
// swapped for 16:9 - quietly ignoring what the story asked for is the exact
// failure this line exists to prevent. It is only warned about, because Flow
// adds ratios from time to time and this list cannot know about them.
const ASPECT = AUTO_RATIO ? null : (ASPECTS[aspectRaw] || null);
const ASPECT_UNKNOWN = !ASPECT && !AUTO_RATIO;

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

// ── the place ----------------------------------------------------------------
// One place for the whole film, and it is mentioned exactly like the cast is.
// That is the whole point of it: every clip already carried the place text
// verbatim and the place still drifted, because a description is a request and a
// reference image is pixels. The plate is uploaded by stage 2 and attached by
// `@Name`, so the name here must be the asset name - no capitalising, no
// tidying, or the mention resolves to nothing and the plate is never attached.
const placeName = (story.place && String(story.place.name || '').trim()) || '';
const placeDesc = (story.place && String(story.place.description || '').trim()) || '';
const mentions = [...(placeName ? ['@' + placeName] : []), ...charNames.map(c => '@' + c)];
const mentionList = mentions.join(' and ');
// Veo 3.1 accepts at most 3 reference images, and the place plate is one of
// them, so a cast of 3 plus a place is a mention that cannot bind.
const OVER_CEILING = mentions.length > 3;

// ── character identity -------------------------------------------------------
// `character_descriptions` is the one thing that makes a cast look like the same
// people from clip to clip, and until now this converter never emitted it. The
// description was written into the story JSON, copied into character_sheets.txt
// for the reference images, and then dropped on the floor here - so the prompt
// named the characters and asked for consistency without ever saying what they
// look like. When the reference chip failed to bind, there was nothing else
// holding the face, and each clip invented its own.
//
// It goes in twice, on purpose. Once as a CAST block, where the agent reads it
// while planning the storyboard; and once inside every scene, because a line
// stated only at the top of a long prompt is a line the per-clip generation
// never sees. The same reasoning as the fixed setting in write_story.js:
// asking once is a request, repeating it into the scene is what makes it true.
const descriptions = (story.character_descriptions && typeof story.character_descriptions === 'object')
    ? story.character_descriptions
    : {};
// The JSON keys the cast lower-case ("tara"); the prompt names them capitalised
// ("Tara"). Accept either spelling rather than silently finding nothing.
const descFor = (name) => {
    const k = String(name || '').trim();
    return descriptions[k] || descriptions[k.toLowerCase()] || null;
};
const described = charNames.filter(c => descFor(c));


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
// `narration_scope: "intro"` is the third mode: one spoken hook over the opening
// clip, then a film carried entirely by sound. It is neither fully narrated nor
// silent, and both of those rule blocks are wrong for it - the narrated one
// promises a voice-over in every clip and forbids a scene from dropping it, and
// the silent one drops the hook. Only write_story.js sets this field, so a story
// without it keeps whichever of the other two modes it had.
const INTRO = story.narration_scope === 'intro';
// `narration_scope: "dialogue"` is the inverse mode: nobody narrates at all and
// the cast speak on screen. Every other rule set here is built on a narrator -
// this one has to say so explicitly, because an agent told nothing about voices
// will narrate a conversation, and an agent told "no dialogue" will refuse to
// make the characters speak at all.
const DIALOGUE = story.narration_scope === 'dialogue';
const SILENT = typeof story.silent_cast === 'boolean'
    ? story.silent_cast
    : /remain silent|mouths closed|no character dialogue|not speaking/i.test(allVp);
// "warm female voice" / "warm male voice" - whatever the story asked for.
const voiceMatch = allVp.match(/(warm|deep|gentle|soft|calm|young|old)?\s*(female|male)\s+voice/i);
const VOICE = (typeof story.narrator_voice === 'string' && story.narrator_voice.trim())
    || (voiceMatch ? voiceMatch[0].trim() : null);

// ── assemble -----------------------------------------------------------------
const L = [];
L.push(charNames.length
? `Create ${scenes.length} separate clips, one clip per scene, using ${mentionList}, up to ${SECONDS} seconds each. Generate them straight away without asking for confirmation.`
        : `Create ${scenes.length} separate clips, one clip per scene, up to ${SECONDS} seconds each. Generate them straight away without asking for confirmation.`);
L.push('');
// Always emitted, narrated or not: the shape of the clip is independent of
// whether the story has a voice-over. "the same ... in every clip" also protects
// the join - concat only copies streams when the clips match, and mixed sizes
// force a re-encode (join_clips.js detects that, but better not to cause it).
L.push(AUTO_RATIO
    ? `FORMAT: keep the aspect ratio the Flow project is already set to. Do not request, crop or change the ratio, and keep it identical in every clip.`
    : `FORMAT: every clip is ${ASPECT || `${aspectRaw} aspect ratio`}. Keep the same aspect ratio in every clip.`);
L.push('');
L.push(`STORY: "${story.title || 'Untitled'}"`);
if (story.description) L.push(story.description);
if (story.moral) L.push(`Message of the story: ${story.moral}`);
L.push('');

if (DIALOGUE) {
    L.push('CRITICAL FORMAT - this is a SPOKEN DIALOGUE VIDEO, not a narrated one:');
    L.push('- There is NO narrator and NO voice-over anywhere in this video. Nothing is');
    L.push('  described out loud. Do not add a narrator, and do not voice the story yourself.');
    L.push('- Every word spoken is spoken by one of the characters, ON SCREEN, in their own');
    L.push('  voice, from the DIALOGUE lines below. Read them exactly as written - do not');
    L.push('  rewrite, shorten, merge or reorder them.');
    L.push('- The characters must visibly speak these lines: mouths move, they look at each');
    L.push('  other, they react to what was just said. This is a conversation, not a tableau.');
    L.push('- Do not invent any line that is not in the DIALOGUE block. No extra dialogue,');
    L.push('  no inner monologue, no narrator summary, no on-screen captions.');
    L.push('- Each character keeps their own voice across all the clips, and the same two');
    L.push('  people stay in the same room with the same light throughout.');
    L.push('- Room tone and the quiet ambience of the place sit under the voices. No music');
    L.push('  that competes with the speaking.');
    L.push('');
} else if (NARRATED && INTRO) {
    L.push('CRITICAL FORMAT - this is a SOUND-LED FILM with one spoken opening hook:');
    if (SILENT && charNames.length) {
        L.push('- The characters are SILENT. Mouths closed. They never speak and have NO dialogue.');
    } else {
        L.push('- The story is carried by what is seen and heard, not by dialogue.');
    }
    L.push(`- CLIP 1 ONLY has a voice-over${VOICE ? ` (${VOICE})` : ''}, reading that scene's`);
    L.push('  NARRATION line below word for word. Do not rewrite or shorten it.');
    L.push('- Clips 2 onward have NO voice-over and NO narration of any kind. Do not add one,');
    L.push('  do not continue the sentence, and do not summarise what happened. The scenes');
    L.push('  after the hook are silent except for their own sound and the music.');
    L.push('- Those clips are driven by their SOUND line below: the real sounds of the place.');
    L.push('  Every clip carries its sound. A clip that comes back quiet is a clip to redo.');
    L.push('- One restrained music bed runs under the whole film, including clip 1, and never');
    L.push('  swells over the sounds of the place.');
    L.push('- Use the SAME narrator voice in clip 1 as specified, and do not reuse it later.');
    L.push('');
} else if (NARRATED) {
    L.push('CRITICAL FORMAT - this is a NARRATED STORYTELLING VIDEO, not a dialogue drama:');
    if (SILENT && charNames.length) {
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

// The cast, stated once in full. Without this the agent is told "using @Tara and
// @Singhania" and never learns what either of them looks like, so the only thing
// holding their face is the reference chip - and a chip that fails leaves
// nothing at all.
if (described.length) {
    L.push('CAST - FIXED APPEARANCE. These are the same people in every clip:');
    for (const c of described) L.push(`  ${c}: ${descFor(c)}`);
    L.push('');
}

// The place, stated once at the top for the same reason the cast is: the agent
// reads this while planning the whole storyboard, before it cuts anything. The
// text is repeated into every scene below (write_story.js prefixes it onto each
// narrative_context), so this block is what tells the agent that the repetition
// is deliberate - one place, and the attached image is what holds it.
if (placeDesc) {
    L.push(`PLACE - FIXED. The whole film happens in ONE place${placeName ? `, attached as @${placeName}` : ''}:`);
    L.push(`  ${placeDesc}`);
    L.push('  That reference image is the place for every clip. Same layout, same');
    L.push('  furniture, same light, same time of day in all of them. Do not move the');
    L.push('  story to another location, do not redecorate, and do not invent a second');
    L.push('  place. Only the camera angle and what the characters do may change.');
    L.push('');
}

// Where the people physically ARE, for the whole film. Same reasoning as the
// place above, one level down: this text is already repeated into every scene's
// visual line, and this block is what tells the agent the repetition is
// deliberate - so a clip that comes back with the two of them standing at the
// window, or with their sides swapped, reads as a mistake rather than a
// variation. A story written before this field existed carries none, and is
// emitted exactly as it was.
const blocking = String(story.blocking || '').trim();
if (blocking) {
    L.push('BLOCKING - FIXED. This is where the characters are, and it is the same in every clip:');
    L.push(`  ${blocking}`);
    L.push('  They do not move from it except where a scene below says in plain words that');
    L.push('  they do. Nobody stands up, sits down, lies down, walks across the room or');
    L.push('  swaps sides between clips, and the one who is on the left stays on the left');
    L.push('  for the whole film. Change the face, the gesture and the camera angle -');
    L.push('  never the seats.');
    L.push('  Where they are is anchored to the FURNITURE, so it is a fact about the room');
    L.push('  and not about the shot: on an over-the-shoulder angle the camera reverses');
    L.push('  and the frame side swaps, and that is the camera moving, not them. Whoever');
    L.push('  is on the bed is on the bed in the close-up too. Never render a clip that');
    L.push('  stands them up, re-seats them somewhere else, or trades their places.');
    L.push('');
}

L.push('SCENES:');
L.push('');
let withNarration = 0;
let withVisual = 0;
let withSound = 0;
let withDialogue = 0;
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

    // Sound brief, for the sound-led mode. script_line is still tried first:
    // clip 1 carries both, and a clip that somehow has both must not lose its
    // hook. The [AUDIO] fallback is what write_story.js emits for a clip with
    // no narration, so older or hand-edited stories resolve the same way.
    let sound = sc.sound_context ? String(sc.sound_context).trim() : '';
    if (!sound) {
        const m = vp.match(/Natural sound only:\s*([\s\S]*)$/i);
        if (m) sound = m[1].trim();
    }

    // Dialogue, for the spoken mode. The fallback reads the attributed lines out
    // of veo3_prompt, which is the same shape write_story.js emits, so a
    // hand-edited story resolves without needing the field.
    let lines = Array.isArray(sc.dialogue)
        ? sc.dialogue
            .map(d => ({ speaker: String((d && d.speaker) || '').trim(), line: String((d && d.line) || '').trim() }))
            .filter(d => d.speaker && d.line)
        : [];
    if (!lines.length && DIALOGUE) {
        const m = vp.match(/\[AUDIO\]\s*([\s\S]*)$/i);
        const seg = m ? m[1] : '';
        if (seg && !/^No dialogue in this clip/i.test(seg.trim())) {
            lines = seg.split(/\s{2,}/).map(part => {
                const mm = part.match(/^(.+?)\s*\(on screen[^)]*\)\s*:\s*"(.*)"\s*$/);
                return mm ? { speaker: mm[1].trim(), line: mm[2].trim() } : null;
            }).filter(Boolean);
        }
    }

    // Visual: narrative_context, or the [SHOT]/[LOOK] sections of veo3_prompt.
    let visual = sc.narrative_context ? String(sc.narrative_context).trim() : '';
    if (!visual) {
        const shot = (vp.match(/\[SHOT\]([\s\S]*?)(?=\[LOOK\]|\[AUDIO\]|$)/i) || [])[1] || '';
        const look = (vp.match(/\[LOOK\]([\s\S]*?)(?=\[AUDIO\]|$)/i) || [])[1] || '';
        visual = `${shot} ${look}`.replace(/\s+/g, ' ').trim();
    }

    L.push(`Scene ${n}${title}`);
    // Who is in THIS clip, and what they look like, spelled out again. The story
    // JSON has always carried scenes[].characters, but it was only ever used to
    // build the union mention list - so the agent had no idea which of the cast
    // was even on screen in a given scene, let alone how they should look.
    const present = (sc.characters || [])
        .map(c => cap(String(c).trim()))
        .filter(c => descFor(c));
    if (present.length) {
        L.push('CHARACTERS IN THIS CLIP - identical to the CAST block and to every other clip. '
            + 'Same face, same age, same hair, same outfit. Do not restyle, do not recast, do not '
            + 'make them look younger or older:');
        for (const c of present) L.push(`  ${c}: ${descFor(c)}`);
    }
    if (DIALOGUE) {
        // Nobody narrates in this mode, so the NARRATION line is not emitted at
        // all - leaving it in with "(none found)" would invite the agent to fill
        // the gap with a narrator.
        if (lines.length) withDialogue++;
        L.push('DIALOGUE (spoken on screen, read exactly):');
        if (lines.length) {
            lines.forEach(d => L.push(`  ${d.speaker}: "${d.line}"`));
        } else {
            L.push('  (nobody speaks in this clip - a silent beat. No narration either.)');
        }
    } else if (narration) {
        withNarration++;
        L.push(`NARRATION (voice-over, read exactly): "${narration}"`);
    } else if (!INTRO) {
        L.push('NARRATION: (none found in the story JSON for this scene)');
    }
    // In the sound-led mode every clip gets a sound brief, including clip 1 -
    // the hook still has wind or traffic under it, and saying so is what keeps
    // the music bed from being the only thing on the audio track.
    if (INTRO) {
        if (sound) withSound++;
        L.push(sound
            ? `SOUND (real sound of this scene, no voice-over): ${sound}`
            : 'SOUND: (no sound brief in the story JSON for this scene - give it the natural '
              + 'sounds of the place, and no voice-over)');
    }
    if (visual) {
        withVisual++;
        L.push(`VISUAL: ${visual}`);
    }
    L.push('');
}

// A no-cast story gets a different closing rule rather than an empty one: the
// agent still needs telling that the absence of people is deliberate, or it
// helpfully adds some.
L.push(charNames.length
    ? `Keep ${charNames.join(' and ')} looking exactly as they do in their reference images in every scene - `
      + 'same face, same age, same hair, same outfit. Use those images as IDENTITY references only: they '
      + 'hold who the characters are, not what the shot looks like. Do not reproduce a reference image as '
      + 'the frame - every clip is a moving shot with a moving camera and moving people, never a still of a '
      + 'sheet. Do not copy a reference frame-for-frame.'
    : 'This video has NO characters' + (placeDesc ? '' : ' and no reference images')
      + '. Do not add people, faces or '
      + 'dialogue. Distant unnamed figures are acceptable only where a scene needs a sense '
      + 'of scale, and they are scenery - never the subject, never in the foreground.');
// The place is a reference image too, so a story with no cast can still have
// something attached - and the closing rule above must not claim otherwise.
if (placeDesc) {
    L.push(`Every clip is in the same place as the ${placeName ? `@${placeName}` : 'place'} reference image. `
        + 'It does not change from clip to clip.');
}
if (blocking) {
    L.push('Every clip has the characters in the BLOCKING positions above, unchanged. This is a '
        + 'conversation held in one spot, not a montage: if a clip moves somebody, or seats them '
        + 'somewhere else, or swaps who is on which side, it is wrong.');
}
if (DIALOGUE) {
    L.push('Nobody narrates this video. Every spoken word belongs to one of the characters '
        + 'above, on screen, and comes from the DIALOGUE lines - no added lines, no '
        + 'narrator, and no one describing what the camera is showing.');
} else if (NARRATED && INTRO) {
    L.push('Do not add any character dialogue anywhere. The only spoken words in the whole '
        + 'video are clip 1\'s voice-over - if any later clip comes back with someone '
        + 'talking, it is wrong.');
} else if (NARRATED) {
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
console.log(`  format     : ${AUTO_RATIO
    ? 'Flow project setting - set the ratio in Flow (tune icon beside the prompt box)'
    : (ASPECT || `${aspectRaw} aspect ratio (unrecognised)`)}`);
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
// The plate is a reference image like any other, and Veo 3.1 takes three. A
// mention past the ceiling is one Flow will not bind, so say which set is over
// rather than letting the run discover it.
if (OVER_CEILING) {
    console.log(`               WARNING: ${mentions.length} mentions (${mentions.join(', ')}) is over the`);
    console.log('               Veo 3.1 ceiling of 3 reference images. The place plate takes one');
    console.log('               of the 3, so drop a character from the mention list to fit.');
}
if (placeDesc) {
    console.log(`  place      : ${placeName || '(unnamed)'} - one place for the whole film,`
        + `${placeName ? ` attached as @${placeName}` : ' no mention (name it to attach the plate)'}`);
} else if (placeName) {
    console.log(`  place      : ${placeName} (named, but the story carries no place description)`);
}
if (blocking) {
    console.log(`  blocking   : one arrangement for the whole film - the characters keep their`);
    console.log(`               seats in all ${scenes.length} clips (${blocking.split(/\s+/).length} words, repeated per scene)`);
}
// A cast with no descriptions is the case that produces drifting faces, so say
// so loudly rather than letting it pass as a normal run.
if (charNames.length && !described.length) {
    console.log('               WARNING: the story has no character_descriptions, so the prompt');
    console.log('               never says what the cast looks like. Their face is then held only');
    console.log('               by the reference image - re-run write_story.js to add descriptions.');
} else if (described.length < charNames.length) {
    console.log(`               WARNING: ${charNames.length - described.length} character(s) have no`);
    console.log('               description and will drift: '
        + charNames.filter(c => !descFor(c)).join(', '));
}
// The `narrated` label keeps its exact old text so the summary of a story that
// was already converted is unchanged; the dialogue mode adds its own line.
console.log(`  narrated   : ${INTRO ? 'HOOK ONLY - clip 1 narrates, the rest are sound-led'
    : NARRATED ? 'YES - voice-over rules added' : 'no'}`);
if (DIALOGUE) {
    console.log(`  speaking   : DIALOGUE - the cast speak on screen, no narrator`);
    console.log(`  dialogue   : ${withDialogue}/${scenes.length} scenes have spoken lines`);
    if (withDialogue < scenes.length) {
        console.log(`               WARNING: ${scenes.length - withDialogue} scene(s) have no dialogue.`);
        console.log('               A clip with nobody speaking is a silent beat - fine once,');
        console.log('               but a conversation needs someone talking in most of it.');
    }
}
console.log(`  narration  : ${withNarration}/${scenes.length} scenes have a line`);
if (INTRO) {
    // The missing narration here is the point, so the ordinary warning would be
    // wrong. What matters instead is that every silent clip still has a sound.
    if (!withNarration) {
        console.log('               WARNING: no scene has narration. This preset opens on a spoken');
        console.log('               hook - add script_line to clip 1 of the story JSON.');
    }
    console.log(`  sound      : ${withSound}/${scenes.length} scenes have a sound brief`);
    if (withSound < scenes.length) {
        console.log(`               WARNING: ${scenes.length - withSound} scene(s) have no sound brief.`);
        console.log('               The agent will invent the audio for those clips. Add sound_context.');
    }
} else if (!DIALOGUE && withNarration < scenes.length) {
    console.log(`               WARNING: ${scenes.length - withNarration} scene(s) have no narration text.`);
    console.log('               The agent will INVENT those scenes. Add script_line to the story JSON.');
}
console.log(`  visuals    : ${withVisual}/${scenes.length} scenes have a visual brief`);
console.log(`  silent cast: ${!charNames.length ? 'n/a - this story has no cast'
    : DIALOGUE ? 'no - the cast speak, that is the point'
    : SILENT ? 'YES - no-dialogue rule added' : 'no'}`);
console.log(`  narrator   : ${DIALOGUE ? '(none - dialogue video)' : VOICE || (NARRATED ? '(unspecified)' : '-')}`);
console.log(`  style      : ${story.style || '(none in story)'}`);
console.log(`  size       : ${body.length} characters`);
