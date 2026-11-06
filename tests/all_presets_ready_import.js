'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const I=require('../import_ready_script'),W=require('../write_story'),G=require('../generic_ready_script');
function sample(p,seconds=8){
 const mode=p.derived_video_preset?p.ready_script_mode==='dialogue'?'dialogue':p.ready_script_mode==='silent_visual'?'silent':'narrated':p.narration_scope==='none'?'silent':p.narration_scope==='intro'?'intro':p.narration_scope==='dialogue'?'dialogue':'narrated';
 let cast=p.reference_cast||p.approved_cartoon_cast||Object.values(p.fixed_couple_names||{}).map(name=>({name,description:'An original adult character with fixed clothing.'}));
 if(!cast.length)cast=p.single_speaker_advice?[{name:'Lilly',description:'Original adult woman, fixed fantasy gown.'},{name:'Pip',description:'Silent green frog animal.'}]:[{name:'Mira',description:'Original adult woman, simple blue coat.'}];
 const header=['Story 1','Title: An Original Kind Gesture',`Preset: ${p.id}`,`Clip seconds: ${seconds}`,`Estimated duration: ${seconds*2} seconds`,'Setting: A calm garden and its adjoining path.','Sources: Synthetic test fixture, no real news claim.','Characters:',...cast.map(c=>`${c.name}: ${c.description}`),'Locations:','Garden: A flowering garden beside a stone path.'];
 const narration={4:'A small kind gesture changes the mood as the garden grows quiet.',6:'A small kind gesture changes the mood as the garden grows quiet, bringing these two neighbors closer together today.',8:'A small kind gesture changes the mood as the garden grows quiet, bringing these two neighbors closer together after a difficult and unusually busy day.',10:'A small kind gesture changes the mood as the garden grows quiet, bringing these two neighbors closer together after a difficult and unusually busy day, with a simple moment of shared understanding.'}[seconds];
 if(p.id==='3d-motivational-red-green')header.push('Left label: WAITING','Right label: DOING','Footer start: STARTING OUT','Footer end: ACTION WINS');
 for(let i=1;i<=2;i++){
  header.push('',`Clip ${i}:`);
  if(mode==='dialogue')header.push(`${p.single_speaker_advice?'Lilly':cast[0].name}: "A small kind gesture can make a difficult day feel easier."`);
  else if(mode==='narrated'||mode==='intro'&&i===1)header.push(`Narration: "${narration}"`);
  header.push('Start state: The characters rest beside the garden path.','Action: A gentle gesture brings the characters closer.');
  if(p.id!=='3d-motivational-red-green'){
   const marker=p.id==='world-politics-map-explain'?(i===1?'[MAP] ':'[EXPLAINER] '):'';
   header.push(`Shot 1: 0–${seconds/2} seconds — ${marker}Show the garden path and the relevant subject in the preset medium.`,`Shot 2: ${seconds/2}–${seconds} seconds — ${marker}Settle on a gentle shared embrace beside the path.`);
  }
  header.push('End state: The characters rest beside the garden path.','Effect: None','Sound: Quiet natural ambience; no speech beyond supplied lines.');
 }
 return header.join('\n');
}
module.exports={sample};
if(require.main===module){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'all-preset-import-')),old=console.log;let passed=0;
 try{
  console.log=()=>{};
  for(const p of W.presetLists())for(const seconds of [4,6,8,10]){
   try{
    const text=sample(p,seconds);const source=I.parse(text)[0],prepared=I.prepare(source,'9:16');
    assert.deepEqual(I.semanticKey(I.parse(require('../ready_script_report').exportScript(source))[0]),I.semanticKey(source),'exported TXT must reimport without losing metadata, shots or speech');
    assert.equal(prepared.story.scenes.length,2);assert.equal(prepared.story.scene_seconds,seconds);assert.equal(prepared.story.preset_id,p.id);
    if(G.appliesPreset(p)){
     assert(prepared.story.generic_ready_import);assert.equal(prepared.story.style,p.style);
     assert.deepEqual(prepared.story.scenes.map(s=>s.script_line),source.clips.map(c=>c.narration||''));
     assert.deepEqual(prepared.story.scenes.flatMap(s=>s.dialogue||[]),source.clips.flatMap(c=>c.dialogue));
     const single=require('../single_scene_prompts').promptForScene(prepared.story,0,{seconds,aspect:'9:16'});
     assert(single.includes(p.style));assert(single.includes('SHOT 1'));
     assert(G.agent(prepared.story,{from:2,to:2,seconds}).includes('Scene 2'));
    }
    if(seconds===8){
     const [file]=I.run({text,out:root,quiet:true});const folder=path.dirname(file);
     assert(fs.existsSync(path.join(folder,'agent_prompt.txt')));assert(fs.existsSync(path.join(folder,'clip_prompts/clip_001.txt')));
     assert(fs.existsSync(path.join(folder,'READY_IMPORT_COMPLETE.json')));
    }
    passed++;
   }catch(e){throw Error(`${p.id} / ${seconds}s: ${e.message}`,{cause:e});}
  }
 }finally{console.log=old;fs.rmSync(root,{recursive:true,force:true});}
 console.log(`PASS: ${passed} preset/duration imports; every preset exported a real local story package, Agent prompt and individual clip prompts. No API/media generation calls.`);
}
