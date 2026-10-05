const assert=require('assert');const fs=require('fs');const S=require('./simple_dialogue_prompt');const R=require('./realistic_couple');
const story={narration_scope:'dialogue',dialogue_prompt_format:'simple',style:'Photorealistic conversation',place:{name:'Room',description:'Bright room'},character_descriptions:{george:R.profiles.george,sarah:R.profiles.sarah},scenes:Array.from({length:18},(_,i)=>({_scene_title:'Turn '+(i+1),dialogue:[{speaker:'George',line:'Please tell me what you need.'},{speaker:'Sarah',line:'I need you to listen calmly.'}]}))};
const text=S.agent(story,{aspect:'9:16',native:true});
assert.equal((text.match(/^Scene \d+ - /gm)||[]).length,18);
for(const scene of story.scenes)for(const d of scene.dialogue)assert(text.includes(`${d.speaker}: "${d.line}"`));
assert(text.includes('pause 0.30 seconds'));assert(!text.includes('SPATIAL BLOCKING'));assert(!text.includes('IDENTITY George:'));
for(const scene of story.scenes){const p=S.plan(story,scene);for(const d of scene.dialogue)assert(p.audio.includes(`${d.speaker} says in a natural ${d.speaker==='George'?'male':'female'} voice: "${d.line}"`));}
assert.equal(R.description({id:'ghibli',fixed_couple_appearance:R.profiles},'Sarah'),null);
assert(R.description({id:'relationship-dialogue-real',fixed_couple_appearance:R.profiles},'George').includes('navy casual jacket'));
assert.throws(()=>S.agent({...story,scenes:[{dialogue:[{speaker:'Random',line:'Hello'}]}]},{native:true}));
console.log('Simple dialogue: all 18 scenes and exact speaker/line pairs preserved; calm turn gaps and realistic-only identities verified.');
