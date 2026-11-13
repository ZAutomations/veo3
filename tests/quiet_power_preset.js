const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const I=require('../import_ready_script'),W=require('../write_story'),G=require('../generic_ready_script');
const id='relationship-cinematic-quiet-power',p=W.presetLists().find(p=>p.id===id);
assert(p&&G.appliesPreset(p));assert.equal(p.narration_scope,'dialogue');assert.equal(p.cast_count,2);
assert(!p.fixed_couple_names&&!p.flow_voice,'male-friend stories must not be remapped into a female/male couple or shared narrator');
assert(p.style.includes('FULL-FRAME COMPOSITION'));
assert.equal(p.content_pillars.length,5);
for(const word of ['Double Standards','Guilt Trips','Betrayal','Too-Late Regret','Power Reversals'])assert(p.content_pillars.some(v=>v.includes(word)),word);
assert(p.direction.includes('NOT COUNSELLING'));assert(p.direction.includes('never a mandatory minimum'));
assert(!/centered 16:9|stable plain black upper|fixed black bars/i.test(p.style+' '+p.camera+' '+p.direction),'portrait must not contain an embedded landscape window');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/quiet_power_ready_script.txt'),'utf8');
const source=I.parse(fixture)[0],prepared=I.prepare(source,'9:16');
assert.equal(prepared.story.scene_seconds,8);assert.equal(prepared.story.scenes.length,4);
assert.deepEqual(prepared.story.scenes.flatMap(s=>s.dialogue),source.clips.flatMap(c=>c.dialogue));
assert(prepared.story.scenes.every(s=>!s.script_line));
assert(G.agent(prepared.story).includes('No narrator'));assert(G.agent(prepared.story).includes('0.30 seconds'));
for(const name of ['SAM','Sarah','Venue'])assert(G.agent(prepared.story).toLowerCase().includes('@'+name.toLowerCase()),name+' must be attached, not just listed in refs.json');
for(const seconds of [4,6,8,10]){
 const example=require('./all_presets_ready_import').sample(p,seconds);
 const result=I.prepare(I.parse(example)[0],'9:16');
 assert.equal(result.story.scene_seconds,seconds);assert.equal(result.story.scenes.length,2);
}
const friendship=fixture.replaceAll('Sarah','Noah').replace('adult woman aged 29','adult man aged 29').replace('black long-sleeve dress','black jacket');
const friend=I.prepare(I.parse(friendship)[0],'9:16');
assert(friend.cast.some(c=>c.name==='Noah'));assert(!friend.cast.some(c=>c.name==='Sarah'));
for(const seconds of [8,10]){
 const three=I.parse(fixture)[0];three.clips=three.clips.slice(0,3);three.seconds=seconds;three.estimatedDuration=3*seconds;
 three.clips.forEach(c=>{c.shots[0].end_seconds=seconds/2;c.shots[1].start_seconds=seconds/2;c.shots[1].end_seconds=seconds;});
 const imported=I.prepare(three,'9:16').story;
 assert.equal(imported.scenes.length,3);assert.equal(imported.scene_seconds*imported.scenes.length,seconds*3);
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quiet-power-import-'));
try{
 const [story]=I.run({text:fixture,out:dir,quiet:true});
 const refs=JSON.parse(fs.readFileSync(path.join(path.dirname(story),'refs.json'))).refs;
 assert.equal(refs.length,3);assert.deepEqual(new Set(refs.map(r=>r.name)),new Set(['SAM','Sarah','Venue']));
 assert(refs.every(r=>r.prompt?.trim()),'every declared reference must have an actual image generation prompt');
 const loaded=require('../refs_for_scene').loadStoryRefs(story,JSON.parse(fs.readFileSync(story))).refs;
 assert.equal(loaded.length,3,'generation loader must retain both character references, not only the location');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
const master=fs.readFileSync(path.join('Master prompts',id+'.txt'),'utf8');
assert(master.includes('FULL-FRAME 9:16'));assert(!/centered 16:9 active|hook for the black top bar|active-picture letterbox is/i.test(master));
assert(master.includes('1 / 3 / 4 / 6 / 8 / Custom'));assert(master.includes('THREE-CLIP OPTION'));
assert(master.includes('WRITING QUALITY GATE'));assert(master.includes('one-word answer can be the pivot'));
for(const required of [id,'FIVE TOPIC PILLARS','Custom positive integer','Shot 1:','Characters:','Story 1','Caption chunks:','END PRODUCTION WORKFLOW V2','[BEGIN COMPLETE STORY PACKAGE DELIVERY V3]'])assert(master.includes(required),required);
assert(fs.existsSync(path.join('Master prompts','Channel creation',id+'.txt')));
console.log('PASS: Quiet Power imports at 4/6/8/10s, preserves named dialogue and male friends, exports two cast references plus location, and includes shared master/channel prompts.');
