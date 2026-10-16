const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),I=require('../import_ready_script');
const text=`Story 1
Title: Blanket Negotiations
Preset: relationship-dialogue-dog-couple
Details:
Duration: 16 seconds. Exactly 2 clips of 8 seconds.
Setting: A cozy living room with two dog beds.
Characters: Sarah and George.
Clip 1:
Action: Sarah tilts her head.
Sarah: "You stole my blanket again."
George: "I was keeping it warm for you."
Clip 2:
Action: George rests his paw on the blanket.
George: "Sharing is caring."
Sarah: "Then care about your own blanket."`;
const parsed=I.parse(text);assert.equal(parsed[0].clips.length,2);assert.equal(parsed[0].seconds,8);
assert.throws(()=>I.parse(text.replace('Clip 2:','Clip 3:')),/consecutive/);
assert.throws(()=>I.parse(text.replace('Duration: 16','Duration: 30')),/declared duration/);
assert.throws(()=>I.parse(text.replace('Sarah: "You stole','Unknown: "You stole')),/unknown field/);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ready-script-'));
try{
 const [file]=I.run({text,aspect:'9:16',out:dir});
 const story=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(story.title,'Blanket Negotiations');assert.equal(story.scene_seconds,8);assert.equal(story.character_species,'dog');assert.equal(story.total_scenes,2);
 assert.deepEqual(story.scenes.flatMap(s=>s.dialogue),parsed[0].clips.flatMap(c=>c.dialogue));
 assert(story.scenes[0].veo3_prompt.includes('Sarah tilts her head'));
 for(const name of ['refs.json','SIMPLE_TEST.json','ALL_SIMPLE_CLIP_PROMPTS.txt','ALL_CLIP_PROMPTS.txt','agent_prompt.txt','clip_prompts/clip_001.txt'])assert(fs.existsSync(path.join(path.dirname(file),name)),name);
 fs.writeFileSync(path.join(path.dirname(file),'keep.mp4'),'preserve');
 assert.equal(I.run({text,aspect:'9:16',out:dir})[0],file);assert.equal(fs.readFileSync(path.join(path.dirname(file),'keep.mp4'),'utf8'),'preserve');
 const human=text.replace('Blanket Negotiations','Human Conversation').replace('relationship-dialogue-dog-couple','relationship-dialogue-ghibli').replace('two dog beds','two chairs');
 const [h]=I.run({text:human,aspect:'16:9',out:dir});const hs=JSON.parse(fs.readFileSync(h,'utf8'));
 assert(hs.scenes[0].veo3_prompt.includes('Sarah tilts her head'));assert(hs.scenes[0].veo3_prompt.includes('Hand-painted 2D'));
 assert.deepEqual(hs.scenes.flatMap(s=>s.dialogue),parsed[0].clips.flatMap(c=>c.dialogue));
 assert.equal(I.parse(text.replace('Duration: 16 seconds. Exactly 2 clips of 8 seconds.','Clip seconds: 6'))[0].seconds,6);
 const batch=I.parse(text+'\n'+human.replace('Story 1','Story 2'));assert.equal(batch.length,2);
 console.log('PASS: local import preserves dialogue/actions, applies dog/Ghibli presets, exports compatible files, validates input and safely preserves repeat imports.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
