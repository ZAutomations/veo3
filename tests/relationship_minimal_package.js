const assert=require('assert');
const minimal=require('../relationship_minimal_package');
const simple=require('../simple_dialogue_prompt');
const presets=require('../styles.json').styles.filter(p=>p.id.startsWith('relationship-dialogue'));
for(const p of presets){
 const s={title:'Test',niche:p.label,narration_scope:'dialogue',scene_seconds:8,place:{name:'Kitchen'},blocking:'Force fixed posture',camera_direction:'Complicated shots',character_descriptions:{},scenes:[{dialogue:[{speaker:'George',line:'I hear you.'},{speaker:'Sarah',line:'Thank you for listening.'}]}]};
 const original=JSON.stringify(s.scenes[0].dialogue);
 assert(minimal.applies(p,s));minimal.apply(s);
 assert.equal(JSON.stringify(s.scenes[0].dialogue),original);
 assert.equal(s.scenes.length,1);assert(!s.blocking&&!s.camera_direction);
 assert(s.scenes[0].veo3_prompt.includes('0.30-second'));
 assert.equal(simple.plan(s,s.scenes[0]).prompt,s.scenes[0].veo3_prompt.trim());
 const agent=simple.agent(s);assert(agent.includes(s.scenes[0].veo3_prompt));assert(!agent.includes('COMPOSITION:'));
 assert.equal(p.dialogue_prompt_format,'minimal-test');
}
assert(!minimal.applies({id:'fern-documentary'},{narration_scope:'dialogue'}));
console.log('PASS: every relationship preset uses minimal prompts; dialogue, speaker order and scene count preserved; no forced camera/blocking; other presets excluded.');
