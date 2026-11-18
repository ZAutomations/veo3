'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),A=require('../audio_first_prompt'),C=require('../external_visual_contract');
const speech='Approved external narration sentinel must never appear in the video generation tool prompt.';
const report=[];
for(const p of C.catalog()){
 const mode=p.ready_script_mode||(p.narration_scope==='dialogue'?'dialogue':p.narration_scope==='none'?'silent':p.narration_scope==='intro'?'intro':'narrated_visual');
 if(mode!=='narrated_visual'){report.push({id:p.id,status:'not a full-narration workflow',mode});continue;}
 const story={preset_id:p.id,audio_first:true,full_voiceover_first:true,style:p.style,palette:p.palette,scene_seconds:10,aspect_ratio:'9:16',place:{name:'Environment'},scenes:[{script_line:'',external_narration:speech,narrative_context:'A visible story-specific subject changes state.',characters:[],start_state:'The marker rests beside the object.',end_state:'The marker indicates the result.',effect:'A cyan outline pulses on the visible object.',sound:'SFX: glass click and quiet footstep; BGM: loud music; Mix: narration foreground.',shots:[{start_seconds:0,end_seconds:5,visual:'[MAP] Establish the real coastline and vessel.'},{start_seconds:5,end_seconds:10,visual:'[EXPLAINER] A visible line connects the two supplied objects.'}]}]};
 if(p.derived_video_preset)story.reference_preset=p;
 const prompt=A.scene(story,0,{seconds:10,aspect:'9:16'});
 assert(prompt.includes(p.id==='geography-map'?'TOOL CALL COPY REQUIREMENT':'PRESET VISUAL DELIVERY'),p.id);
 assert(prompt.includes(p.id==='geography-map'?'CAMERA PHASES':'PRESET CAMERA:'),p.id);
 assert(prompt.includes('cyan outline pulses'),p.id);
 assert(prompt.includes('glass click and quiet footstep'),p.id);
 assert(!prompt.includes(speech),p.id+' leaked external narration');
 assert(!prompt.includes('BGM: loud music'),p.id+' leaked source BGM');
 assert(prompt.includes('NO narration, dialogue, speech'),p.id);
 if(['3d-zack-style','intimacy-health-3d','cats-behavior-3d'].includes(p.id))assert(prompt.includes('ZACK ANIMATED ROUND PICTOGRAM BADGES'),p.id);
 if(p.id==='fern-documentary')assert(prompt.includes('FERN TOPIC AND IDENTITY')&&prompt.includes('faceless matte 3D mannequin'));
 if(p.id==='world-politics-map-explain')assert(prompt.includes('WORLD POLITICS HYBRID')&&prompt.includes('RECONSTRUCTION'));
 if(p.derived_video_preset)assert(prompt.includes('REFERENCE-DERIVED VISUAL DNA'));
 report.push({id:p.id,status:'wired',mode});
}
assert.equal(C.sfxOnly('SFX: metal click; BGM: synth music; Mix: narration foreground.'),'metal click;');
assert(!JSON.stringify(C.visualDNA({visual:{palette:'gold',audio:'Read this aloud'},voice:'speaker'})).includes('Read this aloud'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'effect-map-'));
try{
 const original=path.join(dir,'source.json');fs.writeFileSync(original,JSON.stringify({scene_seconds:10,scenes:[{effect:'First glow',sound:'SFX: soft click'},{effect:'Second glow',sound:'SFX: quiet splash'}]}));
 const events=C.sourceEvents({full_voiceover_first:true,original_story:original,full_voiceover_sections:[[0,12],[12,22]]},{full_voiceover_start:10,full_voiceover_end:20});
 assert.equal(events.length,2);assert.equal(events[0].start_seconds,0);assert.equal(events[0].end_seconds,2);assert.equal(events[1].start_seconds,2);assert.equal(events[1].end_seconds,10);
 assert.equal(events[1].source_end_seconds,8);
}finally{fs.rmSync(dir,{recursive:true,force:true})}
fs.mkdirSync('outputs/preset_visual_audit',{recursive:true});fs.writeFileSync('outputs/preset_visual_audit/report.json',JSON.stringify(report,null,2));
console.log(`PASS: ${report.filter(r=>r.status==='wired').length} narrated presets wired; ${report.filter(r=>r.status!=='wired').length} dialogue/silent/intro presets kept separate; effects/SFX, camera/style DNA, no speech/BGM leak and legacy effect timing verified.`);

const custom={preset_id:'reference-custom-fixture',audio_first:true,full_voiceover_first:true,style:'Hand-cut paper silhouettes.',scene_seconds:10,reference_preset:{id:'reference-custom-fixture',style:'Hand-cut paper silhouettes.',camera:'Locked fixed camera; no zoom or pan.',setting:'One illustrated study.',direction:'Layered paper textures. Read exactly: never copy this voice instruction.',analysis_dna:{visual_grammar:{materials:'Paper edges',audio:'Read the whole text'},audio_grammar:'Native narrator'}},scenes:[{script_line:'',external_narration:speech,narrative_context:'A paper figure points to a paper window.',shots:[{start_seconds:0,end_seconds:10,visual:'Fixed view of the paper study.'}]}]};
const locked=A.scene(custom,0,{seconds:10,aspect:'9:16'});
assert(locked.includes('Paper edges')&&locked.includes('One illustrated study'));
assert(!locked.includes('WITHIN-CLIP CAMERA PAN')&&!locked.includes('FAST DETAIL-REVEAL'));
assert(!locked.includes('Read the whole text')&&!locked.includes('never copy this voice instruction'));
console.log('PASS: custom reference visual DNA and locked setting survive without importing native voice instructions or forcing camera travel.');
