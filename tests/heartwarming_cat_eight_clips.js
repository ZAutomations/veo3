const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const I=require('../import_ready_script'),C=require('../heartwarming_cat');
const preset=JSON.parse(fs.readFileSync(path.join(__dirname,'../styles.json'),'utf8')).styles.find(p=>p.id===C.ID);
assert.equal(preset.default_duration,64);assert.equal(preset.default_clip_count,8);
assert.equal(C.locationName({place_description:'A peaceful bedroom with a bed and bedside lamp.'}),'Bedroom');
assert.throws(()=>C.locationName({place_name:'Cat'}),/distinct/);
const state='Girl sits beside the bed; Cat rests on the quilt with the teddy beside its paws.';
const text='Story 1\nTitle: A Quiet Bedtime Cuddle\nPreset: heartwarming-cat-3d\nClip seconds: 8\nEstimated duration: 64 seconds\nLocation name: Bedroom\nSetting: A cozy bedroom with a cream bed, oak bedside table, warm lamp and cool rainy window.\n'+Array.from({length:8},(_,i)=>`\nClip ${i+1}:\nStart state: ${state}\nShot 1: 0–3 seconds — Cat nudges its teddy as Girl gently strokes its back.\nShot 2: 3–8 seconds — ${i===7?'Girl and Cat hold a gentle cheek-to-cheek cuddle.':'Cat settles near Girl while the teddy stays beside it.'}\nEnd state: ${state}\nAudio: Quiet piano and acoustic guitar at 78 BPM, warm major strings at final cuddle, soft rain and purring; no speech.\n`).join('');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cat-eight-'));
try{
 const [file]=I.run({text,out:temp,aspect:'9:16'});const folder=path.dirname(file),story=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(story.total_scenes,8);assert.equal(story.video_duration,'64 seconds');assert.equal(story.place.name,'Bedroom');
 const refs=JSON.parse(fs.readFileSync(path.join(folder,'refs.json'),'utf8')).refs;
 assert.equal(refs.length,3);assert.deepEqual(refs.map(r=>r.name.toLowerCase()).sort(),['bedroom','cat','girl']);
 assert(refs.find(r=>r.kind==='place').prompt.includes('cozy bedroom'));
 assert(!refs.find(r=>r.kind==='place').prompt.includes('living room, hallway and kitchen'));
 for(let i=1;i<=8;i++){
  const prompt=fs.readFileSync(path.join(folder,'clip_prompts',`clip_${String(i).padStart(3,'0')}.txt`),'utf8');
  assert(prompt.includes('@Girl')&&prompt.includes('@Cat')&&prompt.includes('@Bedroom'));
  assert(!prompt.includes('@Home'));assert(prompt.includes('Exactly three reference images'));
 }
 const master=fs.readFileSync(path.join(__dirname,'../Master prompts/heartwarming-cat-3d.txt'),'utf8');
 assert(master.includes('Estimated duration: 64 seconds'));assert(master.includes('Location name:'));assert(!master.includes('40 seconds (5 clips, recommended)'));
 console.log('PASS: default 8x8=64s, all eight exported prompts attach Girl/Cat/Bedroom, exactly three reference records, room-specific image prompt and updated master.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
