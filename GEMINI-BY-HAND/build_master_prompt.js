// Build the one-prompt version of the preset.
//
// write_story.js makes TWO calls per film: call 1 designs the cast, the place and
// the outline; call 2 writes the clips and is HANDED call 1's answer. By hand, in
// a chat window, that is one conversation: the same prompt does both jobs, and
// part 2 uses the cast and beats that part 1 produced.
//
// Nothing about the preset's wording is rewritten here. This takes the exact text
// the tool sends (preset_prompt_relationship_real.txt, straight out of --dry-run)
// and replaces only the handful of lines that a run fills in at run time: the
// title, the creator's detail, and in call 2 the cast/beats/"write exactly 6
// clips" placeholders.
// Both files sit in this folder with it, so it runs from anywhere:
//
//   node build_master_prompt.js
//
// Regenerate preset_prompt_relationship_real.txt with, from the tool's folder:
//
//   node write_story.js --title "PLACEHOLDER TITLE" --preset relationship-dialogue-real --dry-run
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SRC = path.join(HERE, 'preset_prompt_relationship_real.txt');
const OUT = path.join(HERE, 'master_prompt_relationship-dialogue-real.md');
const L = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

// Line numbers are 1-based from the dry-run file; slice is 0-based.
const call1 = L.slice(15, 174);   // CALL 1 body: lines 16-174
const call2 = L.slice(178);       // CALL 2 body: lines 179 to the end

function swap(lines, from, to, why) {
    const i = lines.findIndex((l) => l.startsWith(from));
    if (i < 0) { console.error(`NOT FOUND (${why}): ${from}`); process.exit(1); }
    lines[i] = to;
    return i;
}

// ── call 1: the three inputs a run supplies ────────────────────────────────
// The title used to be the run's --title, handed in above the prompt. By hand
// there is no --title, so the model takes it off the video instead - which is
// also what the folder and the story get named after.
swap(call1, 'TITLE: ',
     'TITLE: the video\'s own title, word for word as it is written on the video. ' +
     'Drop any emoji, hashtags, channel name or " #shorts" from it, and keep it to ' +
     '8 words or fewer. This becomes the story\'s name, so it has to read as a title.',
     'title');
swap(call1, 'DETAIL FROM THE CREATOR: ',
     'THE VIDEO TO COVER: the link is at the end of this message. Watch it. Cover ITS facts, ' +
     'in ITS order, rewritten in your own words as a film in this genre - the facts are the ' +
     'ground truth, the wording is entirely yours.',
     'detail');
swap(call1, 'TOTAL LENGTH: ',
     'TOTAL LENGTH: decide the clip count from the video\'s own length - roughly one beat per ' +
     '8 seconds of video, minimum 6 clips, maximum 20. Each clip is 8 seconds.',
     'length');
// TASK 7 hardcodes the clip count the run was started with ("exactly 7 entries"),
// which no longer matches a count taken from the video. These sentences wrap onto
// the next line, so replace the words and keep whatever follows them.
function refix(lines, from, to, why) {
    const i = lines.findIndex((l) => l.includes(from));
    if (i < 0) { console.error(`NOT FOUND (${why}): ${from}`); process.exit(1); }
    lines[i] = lines[i].replace(from, to);
}

refix(call1, 'exactly 7 entries, one per clip.', 'exactly as many entries as there are clips.',
      'outline count');
refix(call1, 'The 7 beats must form', 'The beats must form', 'outline sentence');
// PART 1's JSON is no longer the last word - PART 2's follows it. It also
// carries "title" now, which the tool's own prompt never asked for because the
// title was a flag on the command line.
refix(call1, 'Return ONLY this JSON, no other text:', 'Then return this JSON, and go on to PART 2:',
      'part 1 json');
refix(call1, '{"description":"",', '{"title":"","description":"",', 'part 1 json title field');

// ── call 2: it is no longer a second call, it uses what part 1 produced ────
swap(call2, 'You are writing clips 1 to ',
     'You are writing the clips of the film whose cast, place and outline YOU designed in ' +
     'PART 1 above. Use exactly that cast, that place and those beats - do not redesign, ' +
     'rename or add anyone.',
     'call 2 opening');

// Call 2 is handed the title and the creator's detail again, the same two inputs
// call 1 got. In one conversation they are already above.
swap(call2, 'TITLE: ', 'TITLE: the title YOU chose in PART 1.', 'call 2 title');
swap(call2, 'DETAIL FROM THE CREATOR: ',
     'STORY: the story YOU designed in PART 1 - its place, its people and its beats, unchanged.',
     'call 2 detail');

// The stage positions, the cast and the beats were placeholders that a run fills
// from call 1's answer. In one conversation they are already above.
for (let i = 0; i < call2.length; i++) {
    if (call2[i].includes('(chosen by call 1 - stated here, word for word, in every clip)')) {
        call2[i] = '  (the blocking YOU wrote in PART 1 - repeat it word for word in every clip)';
    }
    if (call2[i].includes('This is where they are in clip 1 and where they are in the last clip.')) {
        call2[i] = '';
    }
    if (call2[i].includes('(the real cast is written at run time)')) {
        call2[i] = '';
    }
    if (call2[i].includes('(the real beat is written at run time)')) {
        call2[i] = '';
    }
}
// The two placeholder cast lines and the seven placeholder beat lines are gone;
// say instead where the real ones are.
const castAt = call2.findIndex((l) => l.startsWith('THE CAST - do not change'));
if (castAt < 0) { console.error('NOT FOUND: THE CAST'); process.exit(1); }
call2.splice(castAt + 1, 0,
             '  The cast is the "characters" array from PART 1. Each description is repeated',
             '  WORD FOR WORD, and every "speaker" below must be one of those names.');

const beatsAt = call2.findIndex((l) => l.startsWith('THE BEATS FOR THESE CLIPS'));
if (beatsAt < 0) { console.error('NOT FOUND: THE BEATS'); process.exit(1); }
call2.splice(beatsAt + 1, 0,
             '  The beats are the "outline" from PART 1: one clip per entry, in that order,',
             '  with that entry\'s own title. Do not add, drop or reorder a beat.');

swap(call2, 'Write exactly ',
     'Write every clip of the outline from PART 1, in order - the JSON below is one "scenes" ' +
     'entry per clip. Return ONLY this JSON, no other text:',
     'clip count');

const head = [
    '# Master prompt - Relationship Dialogue (Realistic)',
    '',
    'Ye wohi prompt hai jo hamara tool Gemini ko bhejta hai, is preset ke liye. Ismein',
    'kuch bhi naya likha nahi gaya - sirf do cheezein jori gayi hain: tool do calls karta',
    'hai (pehle cast + outline, phir clips) aur yahan dono ek hi message mein hain, aur',
    'runtime par jo cheezein tool khud bharta hai (title, cast, beats) unki jagah ye',
    'hidayat hai ke PART 1 mein jo aapne likha wohi use karo.',
    '',
    '**Kaise use karein:** neeche diye gaye cut-off ke baad ka poora text copy karein,',
    'Gemini (AI Studio) mein paste karein, aur sab se aakhir mein apna video link laga',
    'dein (`<PASTE THE VIDEO LINK HERE>` ki jagah). Gemini ek hi jawab mein dono JSON',
    'dega - pehla title/cast/place/outline, doosra scenes. Pehle JSON mein video ka',
    'apna title bhi hoga: story aur uska folder usi naam se banega, is liye aapko title',
    'khud likhne ki zaroorat nahi.',
    '',
    'Agar Gemini itna lamba text ek saath na le, to usi chat mein do hisson mein',
    'bhej dein: pehle `PART 1` se `PART 1` ke JSON tak, phir `PART 2` se aakhir tak.',
    '',
    'NOTE: video ka format (16:9 ya 9:16) is prompt ka hissa nahi - woh tool render ke',
    'waqt lagata hai. Prompt mein 8 second ka zikr sirf isliye hai ke har line 8 second',
    'mein bolne layak rahe.',
    '',
    '===================== YAHAN SE NEECHE COPY KAREIN =====================',
    '',
    '',
].join('\n');

const body = [
    'ONE JOB, IN TWO PARTS. PART 1 designs the film: the cast, the one place it happens',
    'in, and the beat-by-beat outline. PART 2 writes the actual clips, using exactly what',
    'PART 1 decided. Return BOTH JSON objects, in order, and nothing else.',
    '',
    '========================================================================',
    'PART 1 - cast, place and outline',
    '========================================================================',
    call1.join('\n').trimEnd(),
    '',
    '========================================================================',
    'PART 2 - the clips',
    '========================================================================',
    'Take the JSON you returned in PART 1 as given: its characters are the cast, its',
    'blocking is where they are, its outline is the beats. Return the second JSON now.',
    '',
    call2.join('\n').trimEnd(),
    '',
    '========================================================================',
    'THE VIDEO',
    '========================================================================',
    'Watch this video and cover its facts in the film you are writing:',
    '',
    '<PASTE THE VIDEO LINK HERE>',
    '',
].join('\n');

const raw = head + body;
// Blanked placeholder lines leave gaps behind them; collapse any run of blank
// lines down to one so the prompt reads as one document.
const all = raw.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(OUT, all, 'utf8');
console.log(`wrote ${OUT}`);
console.log(`chars: ${all.length}   lines: ${all.split('\n').length}`);
