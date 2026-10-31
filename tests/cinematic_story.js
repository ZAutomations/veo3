const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const I=require('../import_ready_script'),C=require('../cinematic_story'),R=require('../refs_for_scene');
function script(count=4){
 const header=`Story 1\nTitle: The lost ticket\nPreset: ${C.ID}\nClip seconds: 8\nEstimated duration: ${count*8} seconds\nSetting: A station and hospital.\nCharacters:\nSarah: Adult woman, brown eyes, oval face, dark bob, navy coat, silver watch. Warm low voice.\nSAM: Adult man, green eyes, short black hair, clean shaven, grey jacket. Calm baritone voice.\nDoctorMaya: Adult woman, brown eyes, braided hair, white coat. Clear measured voice.\nLocations:\nStationHall: Pale stone station hall, wooden bench, blue clock.\nHospitalRoom: White room, bed by the window, green chair.\n`;
 return header+Array.from({length:count},(_,i)=>`\nClip ${i+1}:\nCharacters: ${i===2?'Sarah, DoctorMaya':i===3?'None':'Sarah, SAM'}\nLocation: ${i<2?'StationHall':'HospitalRoom'}\nTransition: ${i===1?'continuous':'cut'}\nAction: ${i===2?'DoctorMaya hands Sarah the ticket.':'The ticket connects their journey.'}\nStart state: ${i===1?'Sarah holds the ticket; SAM stands by the bench.':'Sarah is ready for the next event.'}\n${i===0?'Sarah: "Is this your ticket?"\n':i===1?'Voice DoctorMaya: "Please come to the hospital."\n':i===2?'DoctorMaya: "He kept it safe for you."\n':''}Shot 1: 0–8 seconds — ${i===3?'An empty room holds the ticket.':'Sarah watches the named other character; only the named visible speaker speaks, slow push-in.'}\nEnd state: Sarah holds the ticket; SAM stands by the bench.\nAudio: Quiet ambience and paper rustle; no music.\n`).join('');
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cinematic-test-'));
try{
 const parsed=I.parse(script())[0],prepared=I.prepare(parsed,'16:9');
 assert.equal(prepared.cast.length,3);assert.equal(prepared.story.total_scenes,4);
 assert.deepEqual(prepared.story.scenes[2].reference_names,['Sarah','DoctorMaya','HospitalRoom']);
 assert(C.scene(prepared.story,2).includes('@HospitalRoom'));assert(!C.scene(prepared.story,2).includes('@StationHall'));
 assert(C.scene(prepared.story,1).includes('DoctorMaya (voice only'));assert(!C.scene(prepared.story,1).includes('@DoctorMaya'));
 assert.throws(()=>C.scene(prepared.story,0,{seconds:10}),/eight-second/);
 const files=I.run({text:script(),preset:C.ID,aspect:'16:9',out:temp});
 const dir=path.dirname(files[0]),refs=R.loadStoryRefs(files[0],prepared.story).refs;
 assert.equal(refs.length,5);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'CONTINUITY_LEDGER.json'))).clips.length,4);
 assert(fs.readFileSync(path.join(dir,'clip_prompts','clip_003.txt'),'utf8').includes('@DoctorMaya'));
 assert(fs.existsSync(path.join(dir,'READY_IMPORT_COMPLETE.json')));
 assert.deepEqual(R.refsForScene(prepared.story.scenes[2],refs).names,['Sarah','DoctorMaya','HospitalRoom']);
 assert.deepEqual(R.refsForScene(prepared.story.scenes[3],refs).names,['HospitalRoom']);
 // Existing scenes without explicit reference lists retain their original place/cast behavior.
 assert.equal(R.refsForScene({characters:['Sarah']},refs).refs.length,3);
 assert.deepEqual(I.run({text:script(),preset:C.ID,aspect:'16:9',out:temp}),files);
 const long=I.parse(script(90))[0];assert.equal(I.prepare(long,'16:9').story.duration,720);
 for(const bad of [script().replace('Clip seconds: 8','Clip seconds: 10'),script().replace('SAM: Adult man','George: Adult man'),script().replace('Characters: Sarah, SAM','Characters: Sarah, SAM, DoctorMaya'),script().replace('Location: StationHall','Location: Missing'),script().replace('Sarah holds the ticket; SAM stands by the bench.\nVoice','Different state.\nVoice'),script().replace('Shot 1: 0–8','Shot 1: 0–7'),script().replace('Sarah: "Is this your ticket?"','Narration: "Something changed."\nSarah: "Is this your ticket?"')])assert.throws(()=>I.parse(bad));
 console.log('PASS: cinematic import, Sarah/SAM identities, supporting speaker, multiple locations, silent shot, scene references, saved ledger, 90-clip film, retries and invalid script rejection. No API calls.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
