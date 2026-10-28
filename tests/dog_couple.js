const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const W=require('../write_story'),D=require('../dog_couple'),S=require('../simple_dialogue_prompt');
const p=W.loadPreset(D.ID);
assert.equal(p.default_duration,64);assert.equal(p.narration_scope,'dialogue');
assert.deepEqual(p.cast_types,['animal']);assert.equal(p.cast_count,2);assert(!W.houseCastApplies(p));
assert(!p.source_dialogue_fidelity);assert(!p.grounded_dialogue);
const cast=W.normaliseCast(p,[{name:'Sarah',gender:'female',description:'human woman in magenta'},{name:'SAM',gender:'male',description:'human man in jacket'}]);
assert(cast.every(c=>c.type==='animal'));assert(cast[0].description.includes('cream-coloured'));assert(cast[1].description.includes('black Labrador'));
const story=W.buildStory(p,cast,{description:'A blanket disagreement.',place_name:'Livingroom',place_description:'A cozy room with a sofa.',place_prompt:'An empty cozy living room.'},[{scene_title:'The blanket',dialogue:[{speaker:'Sarah',line:'You stole my blanket again.'},{speaker:'SAM',line:'I was keeping it warm for you.'}],narrative_context:'Sarah tilts her head; SAM rests his paw on the blanket.',characters:['Sarah','SAM']}]);
assert.equal(story.character_species,'dog');assert.equal(story.narrated,false);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dog-couple-'));
try{
 W.writePackage(dir,p,story,cast);
 const prompt=fs.readFileSync(path.join(dir,'simple_test_clip_prompts','clip_001.txt'),'utf8');
 assert(prompt.includes('Sarah (female adult voice)'));assert(prompt.includes('SAM (male adult voice)'));
 assert(prompt.includes('0.30-second'));assert(prompt.includes('Sarah tilts her head'));assert(prompt.includes('canine muzzle'));
 assert(!/adult woman|adult man|magenta|navy jacket/i.test(prompt));
 const simple=JSON.parse(fs.readFileSync(path.join(dir,'SIMPLE_TEST.json'),'utf8'));
 assert(S.plan(simple,simple.scenes[0]).prompt.includes('female adult voice'));
 const agent=S.agent(simple);assert(agent.includes('@Sarah'));assert(agent.includes('@SAM'));assert(agent.includes('@Livingroom'));assert(agent.includes('coat colours'));
 assert(fs.existsSync(path.join(dir,'ALL_SIMPLE_CLIP_PROMPTS.txt')));
 const file=path.join(dir,'dog_story.json');fs.writeFileSync(file,JSON.stringify(simple));
 // Even invalid saved human paths cannot replace these dog identities.
 assert.deepEqual(D.savedForStory(file,'agent',{agent_saved_couple:true,couple_sarah_file:'missing'}),[]);
 assert.equal(D.savedForStory(dir,'ingredients',{ing_saved_couple:true,couple_sarah_file:'missing'}),null);
 assert(D.isDogRefs([{prompt:cast[0].sheet_prompt}]));
 assert(!D.isDogRefs([{prompt:'An adult woman in a magenta top.'}]));
 assert(D.cast(p,{title:'Blanket',detail:'A clean joke',count:8,seconds:8}).includes('Exactly 8 outline entries'));
 assert(D.scenes(p,{title:'Blanket',detail:'',count:8,seconds:8,outline:Array(8).fill({beat:'joke'}),from:5,to:8}).includes('exactly 3 scenes'));
 console.log('PASS: dog preset, fixed canine identities, clean comedy writer, simple files, Agent references and saved-human isolation.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
