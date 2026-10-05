const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const {execFileSync} = require('child_process');
const {ingredientsCameraPrompt} = require('./ingredients_camera');
const {withDialogueAudio} = require('./dialogue_speakers');
const {Veo3FlowNewUI} = require('./veo3_flow_new_ui');
const scene = {characters:['sarah','george'],dialogue:[{speaker:'George',line:'The camera is static in that film.'},{speaker:'Sarah',line:'I understand what you mean.'}],
    narrative_context:'They sit together. The camera remains in a static wide two-shot at eye level.',
    veo3_prompt:'[SHOT] They sit together. The camera remains in a static wide two-shot at eye level.\n[LOOK] Photorealistic\n[AUDIO] George: "The camera is static in that film." Sarah: "I understand what you mean."'};
const story = {title:'A quiet conversation',narration_scope:'dialogue',narrated:false,silent_cast:false,aspect_ratio:'9:16',scene_seconds:8,
    character_descriptions:{sarah:'Female in green.',george:'Male in blue.'},character_references:{sarah:'Sarah.jpg',george:'George.jpg'},scenes:[scene]};
const original = JSON.stringify(story);
const audio = withDialogueAudio(story,scene,scene.veo3_prompt);
const prepared = ingredientsCameraPrompt(story,scene,audio);
assert(!prepared.split('\n[AUDIO]')[0].includes('The camera remains in a static wide two-shot'));
assert.strictEqual(prepared.split('\n[AUDIO]')[1],audio.split('\n[AUDIO]')[1], 'Camera rewrite changed dialogue');
assert(prepared.indexOf("George's face") < prepared.indexOf("Sarah's face"), 'Focus order ignored the first speaker');
assert(prepared.includes('final half-second') && prepared.includes('same two-person framing'));
assert.strictEqual(ingredientsCameraPrompt(story,scene,prepared),prepared, 'Repeated run duplicated camera instructions');
const engine = Object.create(Veo3FlowNewUI.prototype);
engine.story=story; engine.refsFor=() => [];
assert(engine.buildIdentityLockedExtendPrompt(scene,scene.veo3_prompt).includes('DIALOGUE SHOTS'));
assert(engine.buildIdentityLockedExtendPrompt(scene,scene.veo3_prompt).startsWith('STRICT CONTINUITY:'));
const single = {...scene,dialogue:[scene.dialogue[0]]};
const singlePrompt = ingredientsCameraPrompt(story,single,withDialogueAudio(story,single,single.veo3_prompt));
assert(singlePrompt.includes("Sarah's face") && singlePrompt.includes('silent listening reaction'));
assert(!singlePrompt.includes('Sarah (female reference character'), 'Added a spoken line for a silent listener');
assert.strictEqual(ingredientsCameraPrompt(story,{dialogue:[]},'Ambient shot'),'Ambient shot');
assert.strictEqual(JSON.stringify(story),original, 'Ingredients changed the shared story');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'veo-ingredients-camera-'));
try {
    const file=path.join(dir,'film_story.json'); fs.writeFileSync(file,original);
    execFileSync(process.execPath,['story_to_agent_prompt.js',file],{stdio:'pipe'});
    const agent=fs.readFileSync(path.join(dir,'agent_prompt.txt'),'utf8');
    assert(!agent.includes('[INGREDIENTS CAMERA]'), 'Ingredients camera leaked into Agent mode');
    assert(agent.includes('DIALOGUE SHOTS'), 'Agent must use the revised speaking shots');
    assert.strictEqual(fs.readFileSync(file,'utf8'),original);
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
console.log('PASS: Ingredients focuses both faces in speaking order and returns to two-shot; exact audio preserved; Extend guard works; Agent camera and shared story unchanged.');
