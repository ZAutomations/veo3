const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const W=require('../write_story'),R=require('../realistic_couple'),L=require('../location_style');
const real=W.loadPreset('relationship-dialogue-real'),p=W.loadPreset('relationship-dialogue-colorful-cartoon');
for(const key of ['narration_scope','dialogue_prompt_format','dialogue_delivery','fixed_couple_names','grounded_dialogue','source_dialogue_fidelity','camera','composition','cast_count'])assert.deepEqual(p[key],real[key],key+' preserves realistic workflow');
assert(!W.houseCastApplies(p));assert(R.enabled(p));
const cast=W.normaliseCast(p,[{name:'Sarah',gender:'female',description:'wrong bridal outfit'},{name:'SAM',gender:'male',description:'wrong navy jacket'}]);
assert(cast[0].description.includes('copper-auburn'));assert(cast[0].description.includes('rolled hems'));
assert(cast[1].description.includes('stubble'));assert(cast[1].description.includes('chest remains plain blue'));
assert(!cast[0].description.includes('Photorealistic human'));assert(R.sheet(p,'Sarah').includes('full-body'));
assert(L.locationPrompt(p,{description:'A kitchen.',prompt:'wrong photorealistic template'}).includes('light grey and off-white'));
const story=W.buildStory(p,cast,{description:'A quiet discussion.',moral:'Listen carefully.',place_name:'Kitchen',place_description:'A light grey and off-white kitchen.'},[{scene_title:'Listening',dialogue:[{speaker:'Sarah',line:'Can we listen to each other?'},{speaker:'SAM',line:'Yes. I want to understand you.'}],narrative_context:'They talk calmly.',characters:['Sarah','SAM']}]);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cartoon-dialogue-'));
try{
 W.writePackage(dir,p,story,cast);
 const prompt=fs.readFileSync(path.join(dir,'simple_test_clip_prompts','clip_001.txt'),'utf8');
 assert(prompt.includes('2D hand-drawn'));assert(prompt.includes('light grey and off-white'));assert(prompt.includes('0.30-second'));assert(prompt.includes('Sarah (female voice)'));assert(prompt.includes('SAM (male voice)'));assert(prompt.includes('No overlapping voices or narrator'));
 assert(!prompt.includes('Human-like 2.5D'));assert.equal(story.narrated,false);
 console.log('PASS: realistic dialogue workflow cloned; cartoon identities, full reference sheets, grey locations, simple spoken prompts and 0.30s gap.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
