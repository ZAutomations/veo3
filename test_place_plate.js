// Tests for the place plate - one locked place per film, made the same way the
// character sheets are and attached the same way.
//
// The relationship-dialogue presets used to HARDCODE a tearoom, so every
// conversation happened in the same room whatever the story was about. They no
// longer do: every preset chooses its own ONE place per story - a bed, a desk, a
// room, a bench - and this file covers that, plus the generic `setting` field
// still working for a genre that genuinely always uses one place.
//
// Run: node test_place_plate.js     (no network)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const W = require('./write_story.js');
const MT = require('./mention_target.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 240) : ''}`); }
}

const talk = W.loadPreset('relationship-dialogue');
const ghibli = W.loadPreset('ghibli');

console.log('\n--- no preset hardcodes a place any more ---');
ok('the dialogue preset declares no setting', !talk.setting, talk.setting);
ok('and no setting asset name', !talk.setting_name, talk.setting_name);
ok('and no setting image prompt', !talk.setting_prompt, talk.setting_prompt);
ok('its realistic twin declares none either',
   !W.loadPreset('relationship-dialogue-real').setting);

console.log('\n--- the character look is the 2.5D semi-realistic style asked for ---');
ok('the style string is 2.5D semi-realistic', /2\.5D semi-realistic/i.test(talk.style), talk.style);
ok('the cast template is 2.5D semi-realistic', /2\.5D semi-realistic/i.test(talk.cast_idiom));
ok('and asks for luminous eyes and glossy semi-realistic skin',
   /luminous/i.test(talk.cast_idiom) && /glossy semi-realistic skin/i.test(talk.cast_idiom));
ok('and rules out photographs and 3D CGI',
   /NOT a photograph/i.test(talk.cast_idiom) && /NOT 3D CGI/i.test(talk.cast_idiom));
ok('and never names a photographic medium in its positive half',
   !/photorealistic/i.test(talk.cast_idiom.split(/\bNOT\b/)[0]));
ok('the whisk wording carries the same look',
   /2\.5D semi-realistic/i.test(talk.whisk) && /luminous eyes/i.test(talk.whisk));

console.log('\n--- every preset is asked to choose ONE place ---');
const ghibliPrompt = W.castPrompt(ghibli);
ok('the ghibli prompt asks the model to choose ONE place',
   /ONE place for this whole film/i.test(ghibliPrompt));
ok('and says the place never changes', /NEVER changes/i.test(ghibliPrompt));
ok('and it can be anywhere, not only a room',
   /park bench/i.test(ghibliPrompt) && /garden/i.test(ghibliPrompt));
ok('and it asks for a name, a description and an image prompt',
   /"place_name"/.test(ghibliPrompt) && /"place_description"/.test(ghibliPrompt) &&
   /"place_prompt"/.test(ghibliPrompt));
ok('and the place prompt is for an EMPTY place',
   /no people and no animals/i.test(ghibliPrompt));
ok('the outline still starts at the right number',
   /6\. Write an "outline": exactly 7 entries/.test(ghibliPrompt), 'the place took slot 5');

const talkPrompt1 = W.castPrompt(talk);
ok('the dialogue preset is asked to choose ONE place too',
   /ONE place for this whole film/i.test(talkPrompt1));
ok('with the place_ fields in its call-1 schema', /"place_name"/.test(talkPrompt1));
ok('and its outline starts at 6, after the place step',
   /6\. Write an "outline": exactly 7 entries/.test(talkPrompt1));
ok('and no locked room leaks into the call-1 prompt',
   !/SETTING \(FIXED/.test(talkPrompt1) && !/tearoom corner/i.test(talkPrompt1));

console.log('\n--- the generic `setting` field still fixes one place ---');
// A preset that genuinely always happens in one place. No preset in styles.json
// does any more, but the field is honoured for one that would.
const fixed = Object.assign({}, talk, {
    setting: 'A quiet tearoom corner by one tall window. A round marble-topped table sits between two upholstered chairs. The room is LOCKED: the same furniture, the same light, the same camera axis in every clip.',
    setting_name: 'Tearoom',
    setting_prompt: '2.5D semi-realistic anime illustration. An empty tearoom corner: a round marble-topped table between two empty upholstered chairs. Straight-on wide view, evenly lit. No people, no animals, no text, no labels, no watermark.',
});
const fixedPrompt = W.castPrompt(fixed);
ok('a preset that declares a setting is not asked to choose one',
   !/ONE place for this whole film/i.test(fixedPrompt));
ok('and its outline starts at 5', /5\. Write an "outline": exactly 7 entries/.test(fixedPrompt));
ok('and the look block states the fixed place', /^SETTING \(FIXED/m.test(W.lookBlock(fixed)));
ok('and a preset with no setting gets no SETTING line', !/^SETTING/m.test(W.lookBlock(talk)));

console.log('\n--- the story carries the place ---');
const cast = [
    { name: 'Vera', type: 'human', description: 'Same Vera throughout - a woman in her seventies.', sheet_prompt: 'a woman' },
    { name: 'Nadia', type: 'human', description: 'Same Nadia throughout - a woman in her twenties.', sheet_prompt: 'a girl' },
];
const scenes = [
    { scene_title: 'Hook', dialogue: [{ speaker: 'Vera', line: 'Sit down.' }],
      narrative_context: 'A wide two-shot.', characters: ['vera', 'nadia'] },
    { scene_title: 'Doubt', dialogue: [{ speaker: 'Nadia', line: 'But what if?' }],
      narrative_context: 'An over-the-shoulder single.', characters: ['vera', 'nadia'] },
];
// The art-style presets narrate rather than speak, so validate wants a
// script_line on each clip. The place is orthogonal to that.
const narrated = [
    { scene_title: 'Hook', script_line: 'She sets down the cup.',
      narrative_context: 'A wide two-shot.', characters: ['vera', 'nadia'] },
    { scene_title: 'Doubt', script_line: 'He does not answer.',
      narrative_context: 'An over-the-shoulder single.', characters: ['vera', 'nadia'] },
];
const metaNoPlace = { description: 'd', moral: 'm', target_audience: 'a' };

// A preset-fixed place: the preset wins even with no place in the story.
const fixedStory = W.buildStory(fixed, cast, metaNoPlace, scenes);
ok('a preset-fixed place arrives in the story',
   fixedStory.place && fixedStory.place.description === fixed.setting, JSON.stringify(fixedStory.place));
ok('with the preset asset name', fixedStory.place.name === fixed.setting_name, fixedStory.place.name);
ok('and the preset image prompt', fixedStory.place.prompt === fixed.setting_prompt);

// The dialogue preset has no place of its own: with no place in the story there
// is none at all, and with one the story's place is the film's.
ok('a dialogue story with no place of its own has no place key',
   !('place' in W.buildStory(talk, cast, metaNoPlace, scenes)));

const chosen = Object.assign({}, metaNoPlace, {
    place_name: 'Park Bench',
    place_description: 'A weathered green bench under a plane tree on the edge of a quiet city park. Gravel path in front, iron railing behind, low hedge to the left. Autumn, early evening, flat grey light, no wind. Nothing in the frame changes between shots.',
    place_prompt: 'Photorealistic 4K film still, 35mm anamorphic. An empty park bench under a plane tree, gravel path, iron railing, low hedge, autumn evening, flat grey light. Straight-on wide view, evenly lit. No people, no animals, no text, no watermark.',
});
const chosenStory = W.buildStory(ghibli, cast, chosen, narrated);
ok('a chosen place arrives too',
   chosenStory.place && chosenStory.place.name === 'Park Bench', JSON.stringify(chosenStory.place));
ok('the film\'s place reaches every clip', chosenStory.scenes.every(s =>
   s.narrative_context.includes(chosen.place_description)));

const bedroom = Object.assign({}, metaNoPlace, {
    place_name: 'Bedroom',
    place_description: 'A soft morning bedroom with a low wooden bed, cream linen and a single window on the left. The light never changes and nothing in the frame moves between shots.',
    place_prompt: '2.5D semi-realistic anime illustration. An empty bedroom, a low wooden bed, cream linen, one window on the left. Wide, evenly lit. No people, no text, no watermark.',
});
const dialogueChosen = W.buildStory(talk, cast, bedroom, scenes);
ok('the dialogue preset takes the place its story chose',
   dialogueChosen.place.name === 'Bedroom' &&
   dialogueChosen.place.description === bedroom.place_description,
   JSON.stringify(dialogueChosen.place));
ok('and every clip carries that place, not a tearoom',
   dialogueChosen.scenes.every(s => s.narrative_context.includes(bedroom.place_description)) &&
   dialogueChosen.scenes.every(s => !/tearoom/i.test(s.narrative_context)));
ok('a story with no place has no place key',
   !('place' in W.buildStory(ghibli, cast, metaNoPlace, narrated)));
// A story written before this field existed must not gain an empty one.
ok('and no empty place object is written', (() => {
    const s = W.buildStory(ghibli, cast, Object.assign({}, metaNoPlace, { place_description: '   ' }), narrated);
    return !('place' in s);
})());

console.log('\n--- validate holds the place it reads off the story ---');
ok('accepts a story whose clips all carry the place',
   W.validate(chosenStory, cast, ghibli).length === 0, W.validate(chosenStory, cast, ghibli).join(' | '));
ok('accepts the dialogue story with its chosen place',
   W.validate(dialogueChosen, cast, talk).length === 0, W.validate(dialogueChosen, cast, talk).join(' | '));
ok('accepts the preset-fixed story too',
   W.validate(fixedStory, cast, fixed).length === 0, W.validate(fixedStory, cast, fixed).join(' | '));
ok('rejects a clip that lost it', (() => {
    const s = JSON.parse(JSON.stringify(chosenStory));
    s.scenes[1].narrative_context = 'A different park across town.';
    return W.validate(s, cast, ghibli).some(b => /clip 2/.test(b) && /fixed place/.test(b));
})());
ok('a story with no place is never asked for one',
   W.validate(W.buildStory(ghibli, cast, metaNoPlace, narrated), cast, ghibli).length === 0);

console.log('\n--- the place plate is written beside the sheets ---');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3_place_'));
function into(sub, preset, story, castList) {
    const dir = path.join(tmp, sub);
    fs.mkdirSync(dir, { recursive: true });
    W.writePackage(dir, preset, story, castList);
    return dir;
}
const withPlace = into('both', ghibli, chosenStory, cast);
const sheets = fs.readFileSync(path.join(withPlace, 'character_sheets.txt'), 'utf8');
ok('the plate gets its own block', /=== PLACE - PARK BENCH ===/.test(sheets));
ok('the place block says what to save it as',
   /save as: character_refs\/Park Bench\.jpg/.test(sheets), sheets.match(/save as: .*/g));
ok('it says the whole film happens there', /ONE place this film happens in/.test(sheets));
ok('it asks for the place empty of people',
   /EMPTY - no people and no animals/.test(sheets));
ok('the plate image prompt is printed', sheets.includes(chosen.place_prompt));
ok('the place text is printed too, for the JSON to match', sheets.includes(chosen.place_description));
ok('the plate carries an image-prompt marker of its own',
   (sheets.match(/-- image prompt --/g) || []).length === 3, 'two sheets and one plate');
ok('the character blocks are still there',
   /=== VERA ===/.test(sheets) && /=== NADIA ===/.test(sheets));
ok('the plate comes after the cast', sheets.indexOf('=== PLACE') > sheets.indexOf('=== NADIA'));
ok('the header counts the plate against the 3-image ceiling',
   /place plate takes one of those slots/.test(sheets));
ok('the header still warns a Flow Character drifts', /drift from cut to cut/.test(sheets));

const presetOut = into('preset', fixed, fixedStory, cast);
const presetSheets = fs.readFileSync(path.join(presetOut, 'character_sheets.txt'), 'utf8');
ok('a preset-fixed place is written the same way',
   /=== PLACE - TEAROOM ===/.test(presetSheets), presetSheets.slice(0, 120));
ok('with the preset image prompt, not "(none generated)"',
   presetSheets.includes(fixed.setting_prompt));

console.log('\n--- a story with a place and no cast still gets its plate ---');
const noCastScenes = [
    { scene_title: 'A', script_line: 'The city empties.', narrative_context: 'Wide.', characters: [] },
    { scene_title: 'B', script_line: 'The lights go out.', narrative_context: 'Wide.', characters: [] },
];
const placeOnly = W.buildStory(ghibli, [], chosen, noCastScenes);
const placeOnlyDir = into('placeonly', ghibli, placeOnly, []);
ok('the files exist', fs.existsSync(path.join(placeOnlyDir, 'character_sheets.txt')));
const onlySheets = fs.readFileSync(path.join(placeOnlyDir, 'character_sheets.txt'), 'utf8');
ok('the plate block is in it', /=== PLACE - PARK BENCH ===/.test(onlySheets));
ok('and no character block is', !/=== VERA ===/.test(onlySheets));
ok('the header is about the place, not about sheets',
   /^Reference image for .* - the place/.test(onlySheets), onlySheets.split('\n')[0]);
ok('and it does not talk about a cast that does not exist',
   !/cast will not match/.test(onlySheets));
const onlyBible = fs.readFileSync(path.join(placeOnlyDir, 'style_bible.md'), 'utf8');
ok('the bible no longer says there is nothing to upload',
   !/nothing to upload - skip straight to stage 1/.test(onlyBible));
ok('it points at the plate instead', /place plate from `character_sheets\.txt`/.test(onlyBible));
ok('and at the file name to save it as', /`Park Bench\.jpg`/.test(onlyBible));

console.log('\n--- the bible tells you how the plate is attached ---');
const bothBible = fs.readFileSync(path.join(withPlace, 'style_bible.md'), 'utf8');
ok('there is a place section', /## The place/.test(bothBible));
ok('it names the place', /\*\*Park Bench\*\*/.test(bothBible));
ok('it carries the place text', bothBible.includes(chosen.place_description));
ok('it gives the save-as name', /character_refs\/Park Bench\.jpg/.test(bothBible));
ok('and the mention to attach it with', /`@Park Bench`/.test(bothBible));
ok('the cast steps still cover the plate', /sheets AND the place plate/.test(bothBible));
ok('a ghibli cast story with no place says nothing about a plate', (() => {
    const d = into('noplace', ghibli, W.buildStory(ghibli, cast, metaNoPlace, narrated), cast);
    const b = fs.readFileSync(path.join(d, 'style_bible.md'), 'utf8');
    return !/## The place/.test(b) && !/place plate/.test(b);
})());

console.log('\n--- the plate resolves from the name the story gives ---');
fs.mkdirSync(path.join(withPlace, 'character_refs'), { recursive: true });
fs.writeFileSync(path.join(withPlace, 'character_refs', 'Park Bench.jpg'), 'x');
ok('the asset name finds the file',
   /Park Bench\.jpg$/.test(MT.resolveCharacterRef({}, chosenStory.place.name, withPlace) || ''),
   MT.resolveCharacterRef({}, chosenStory.place.name, withPlace));
ok('the case does not have to match',
   /Park Bench\.jpg$/.test(MT.resolveCharacterRef({}, 'park bench', withPlace) || ''));
ok('a place with no image yet resolves to null, not a throw',
   MT.resolveCharacterRef({}, 'Nowhere', withPlace) === null);

console.log('\n--- the agent prompt mentions the plate ---');
const storyFile = path.join(withPlace, 'place_story.json');
fs.writeFileSync(storyFile, JSON.stringify(chosenStory, null, 2), 'utf8');
const convert = (file, ...args) => execFileSync(process.execPath,
    [path.join(__dirname, 'story_to_agent_prompt.js'), file, '--print', ...args],
    { encoding: 'utf8' });
const out = convert(storyFile);
const body = out.split('\n').slice(0, out.indexOf('\n  story      :')).join('\n');
ok('the mention line carries the place first',
   /using @Park Bench and @Vera and @Nadia/.test(body), body.split('\n')[0]);
ok('there is a PLACE block', /PLACE - FIXED/.test(body));
ok('it names the attached image', /attached as @Park Bench/.test(body));
ok('it carries the place text', body.includes(chosen.place_description));
ok('it forbids moving the story elsewhere', /Do not move the\s+story to another location/.test(body));
ok('it says what MAY change', /Only the camera angle and what the characters do may change/.test(body));
ok('the closing rule repeats it', /same place as the @Park Bench reference image/.test(body));
ok('the summary reports the place',
   /place {6}: Park Bench - one place for the whole film, attached as @Park Bench/.test(out),
   out.match(/place.*/)?.[0]);
ok('a cast of 2 plus the plate is exactly at the ceiling and is not warned about',
   !/over the/.test(out), out.match(/WARNING: .*mentions.*/)?.[0]);

// The same conversion for the dialogue preset's chosen place: the mention must
// be the story's asset name.
const talkFile = path.join(tmp, 'talk_story.json');
fs.writeFileSync(talkFile, JSON.stringify(dialogueChosen, null, 2), 'utf8');
const talkOut = convert(talkFile);
const talkBody = talkOut.split('\n').slice(0, talkOut.indexOf('\n  story      :')).join('\n');
ok('the dialogue place is mentioned too',
   /using @Bedroom and @Vera and @Nadia/.test(talkBody), talkBody.split('\n')[0]);
ok('its PLACE block uses the story text', talkBody.includes(bedroom.place_description));
ok('and names the story asset', /attached as @Bedroom/.test(talkBody));

// A story with no place must not grow a mention or a block for one.
const plainFile = path.join(tmp, 'plain_story.json');
fs.writeFileSync(plainFile, JSON.stringify(W.buildStory(ghibli, cast, metaNoPlace, narrated), null, 2), 'utf8');
const plainOut = convert(plainFile);
const plainBody = plainOut.split('\n').slice(0, plainOut.indexOf('\n  story      :')).join('\n');
ok('a story with no place gets no PLACE block', !/PLACE - FIXED/.test(plainBody));
ok('and no extra mention', /using @Vera and @Nadia,/.test(plainBody), plainBody.split('\n')[0]);
ok('and no place line in the summary', !/^ {2}place {6}:/m.test(plainOut));
ok('and no ceiling warning', !/over the/.test(plainOut));

const threeFile = path.join(tmp, 'three_story.json');
const threeStory = JSON.parse(JSON.stringify(chosenStory));
threeStory.scenes[0].characters = ['vera', 'nadia', 'ines'];
threeStory.character_descriptions.ines = 'Same Ines throughout - a teenage girl.';
fs.writeFileSync(threeFile, JSON.stringify(threeStory, null, 2), 'utf8');
ok('3 characters + a place is exactly 4 mentions and is warned about',
   /WARNING: 4 mentions \(@Park Bench, @Vera, @Nadia, @Ines\)/.test(convert(threeFile)),
   convert(threeFile).match(/WARNING: .*mentions.*/)?.[0]);

console.log('\n--- a place named but never described is reported, not hidden ---');
const namedOnly = JSON.parse(JSON.stringify(chosenStory));
namedOnly.place = { name: 'Park Bench' };
fs.writeFileSync(path.join(tmp, 'named.json'), JSON.stringify(namedOnly, null, 2), 'utf8');
const namedOut = convert(path.join(tmp, 'named.json'));
ok('the mention is still attached', /using @Park Bench/.test(namedOut));
ok('but the summary says the story has no place text',
   /named, but the story carries no place description/.test(namedOut),
   namedOut.match(/place.*/)?.[0]);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
