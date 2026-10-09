const assert = require('assert');
const fs = require('fs');
const {shotPlan} = require('../dialogue_shot_plan');
const story = JSON.parse(fs.readFileSync('stories/transactional_love_a_midnight_marital_reckoning/SIMPLE_TEST.json','utf8'));
assert.equal(story.scenes.length,14);
for(const scene of story.scenes){
    const first=shotPlan(story,scene).prompt;
    const next=shotPlan(story,scene,{extend:true}).prompt;
    assert.equal(first,scene.veo3_prompt.trim());
    assert(next.startsWith('Continue from the previous clip for 8 seconds.'));
    assert(!/eye contact|eyeline|close-up|camera axis|rack focus/i.test(next));
    for(const d of scene.dialogue){assert(first.includes(JSON.stringify(d.line)));assert(next.includes(JSON.stringify(d.line)));}
    assert(next.includes('0.30-second'));
}
console.log('PASS: all 14 Ingredients test prompts preserve dialogue and omit detailed camera/eyeline instructions.');
