const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const D = require('./dialogue_speakers'), W = require('./write_story');
for (const id of ['relationship-dialogue', 'relationship-dialogue-real', 'relationship-dialogue-ghibli']) {
    const preset = W.loadPreset(id);
    assert.deepStrictEqual(preset.fixed_couple_names, {female:'Sarah',male:'George'}, id);
    assert(preset.require_source_speaker_gender, id);
    const source = 'Male: You have to believe me. >> Female: Do you love your wife? >> Male: Of course, I love my wife.';
    const swapped = [{dialogue:[{speaker:'Sarah',line:'You have to believe me.'},{speaker:'George',line:'Do you love your wife?'},{speaker:'Sarah',line:'Of course, I love my wife.'}]}];
    assert.deepStrictEqual(D.alignUnlabelledTranscript(preset,swapped,source)[0].dialogue.map(d => d.speaker), ['George','Sarah','George']);
    assert.throws(() => D.labelledTranscriptTurns('Do you love your wife? >> Of course, I love my wife.'), /Label EVERY/);
}
const story = {title:'The marriage question',narration_scope:'dialogue',narrated:false,silent_cast:false,aspect_ratio:'9:16',scene_seconds:8,
    character_descriptions:{sarah:'Female in green blouse.',george:'Male in blue suit.'},character_references:{sarah:'Sarah.jpg',george:'George.jpg'},
    scenes:[{_scene_number:1,characters:['sarah','george'],dialogue:[{speaker:'Sarah',line:'Do you love your wife?'},{speaker:'George',line:'Of course, I love my wife.'}],veo3_prompt:'[SHOT] Keep this exact setting.\n[LOOK] Film\n[AUDIO] George says the question. Sarah says the answer.'}]};
const before = JSON.stringify(story.scenes[0].dialogue);
const prompt = D.withDialogueAudio(story,story.scenes[0],story.scenes[0].veo3_prompt);
assert(prompt.includes('[SHOT] Keep this exact setting.\n[LOOK] Film'));
assert(!prompt.includes('George says the question'));
assert(prompt.includes('Sarah (female reference character, female voice; only Sarah speaks'));
assert(prompt.includes('George (male reference character, male voice; only George speaks'));
assert(prompt.indexOf('"Do you love your wife?"') < prompt.indexOf('"Of course, I love my wife."'));
assert.strictEqual(JSON.stringify(story.scenes[0].dialogue),before);
const {Veo3FlowNewUI} = require('./veo3_flow_new_ui');
const engine = Object.create(Veo3FlowNewUI.prototype);
engine.story = story; engine.refsFor = () => [];
assert(engine.buildIdentityLockedExtendPrompt(story.scenes[0],story.scenes[0].veo3_prompt).includes('Sarah says in a natural female voice'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'veo-speakers-'));
try {
    const file = path.join(dir,'film_story.json'); fs.writeFileSync(file,JSON.stringify(story));
    execFileSync(process.execPath,['story_to_agent_prompt.js',file],{stdio:'pipe'});
    const agent = fs.readFileSync(path.join(dir,'agent_prompt.txt'),'utf8');
    assert(agent.includes('Sarah says in a natural female voice'));
    assert(agent.includes('George says in a natural male voice'));
    assert(agent.includes('"Do you love your wife?"'));
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
console.log('PASS: all relationship presets enforce source identity; stale audio replaced; first clip, Extend and Agent preserve per-turn voices and exact dialogue.');
