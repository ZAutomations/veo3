const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const {execFileSync} = require('child_process');
const {shotPlan} = require('./dialogue_shot_plan');
const {Veo3FlowNewUI} = require('./veo3_flow_new_ui');
const story = JSON.parse(fs.readFileSync('stories/the_patterns_we_ignore/the_patterns_we_ignore_story.json','utf8'));
const before = JSON.stringify(story);
function spoken(prompt) {
    return [...prompt.matchAll(/(George|Sarah) says in a natural (?:male|female) voice: "([^\n]*)"/g)].map(m=>({speaker:m[1],line:m[2]}));
}
const engine=Object.create(Veo3FlowNewUI.prototype);engine.story=story;engine.refsFor=()=>[];
for(const scene of story.scenes) {
    const plan=shotPlan(story,scene);
    assert.deepStrictEqual(spoken(plan.prompt),scene.dialogue);
    assert(!/empty of people|wide two-shot at eye level|back slightly turned/i.test(plan.prompt));
    assert(plan.visual.includes(`${scene.dialogue[0].speaker} delivers the first line`));
    assert(plan.visual.includes('return to the established two-person framing'));
    assert.deepStrictEqual(spoken(engine.buildIdentityLockedExtendPrompt(scene,'stale swapped cached prompt')),scene.dialogue);
}
assert.strictEqual(JSON.stringify(story),before);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'veo-shot-plan-'));
try {
    const file=path.join(directory,'film_story.json');fs.writeFileSync(file,before);
    execFileSync(process.execPath,['story_to_agent_prompt.js',file,'--aspect','9:16'],{stdio:'pipe'});
    const agent=fs.readFileSync(path.join(directory,'agent_prompt.txt'),'utf8');
    assert.deepStrictEqual(spoken(agent),story.scenes.flatMap(s=>s.dialogue));
    assert(!agent.includes('empty of people'));
    assert(!agent.includes('wide two-shot at eye level'));
    execFileSync(process.execPath,['story_to_agent_prompt.js',file,'--scene-from','7','--scene-to','12','--out',path.join(directory,'batch.txt')],{stdio:'pipe'});
    assert.deepStrictEqual(spoken(fs.readFileSync(path.join(directory,'batch.txt'),'utf8')),story.scenes.slice(6,12).flatMap(s=>s.dialogue));
    const femaleFirst={...story.scenes[0],dialogue:[{speaker:'Sarah',line:'Your turn.'},{speaker:'George',line:'I understand.'},{speaker:'George',line:'Let me finish.'}]};
    assert.deepStrictEqual(spoken(shotPlan(story,femaleFirst).prompt),femaleFirst.dialogue);
    assert(shotPlan(story,femaleFirst).visual.includes('Sarah delivers the first line'));
    assert.strictEqual(shotPlan({...story,narration_scope:'intro'},story.scenes[0]),null);
} finally { fs.rmSync(directory,{recursive:true,force:true}); }
console.log('PASS: all 18 scenes preserve every speaker, word and turn exactly in Agent, batches and Extend; stale prompts overridden; conflicting visual instructions removed.');
