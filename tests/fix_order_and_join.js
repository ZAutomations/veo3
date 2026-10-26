const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {fixAndJoin}=require('../fix_order_and_join');
(async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fix-and-join-'));
 try{
  const story=path.join(folder,'test_story.json'),clips=path.join(folder,'clips');fs.mkdirSync(clips);
  fs.writeFileSync(story,JSON.stringify({scenes:[{script_line:'first'},{script_line:'second'}]}));
  for(const f of ['a.mp4','b.mp4'])fs.writeFileSync(path.join(clips,f),'unchanged original');
  const verified={complete:true,clips:[{file:'b.mp4',matched_scene:1,order_verified:true,got:true},{file:'a.mp4',matched_scene:2,order_verified:true,got:true}],narrationWarnings:[{scene:1}]};
  const calls=[],logs=[];
  await fixAndJoin(story,{log:t=>logs.push(t),run:async(script,args)=>{calls.push([script,args]);if(script==='order_clips_by_dialogue.js')fs.writeFileSync(path.join(clips,'manifest.json'),JSON.stringify(verified));return 0;}});
  assert.deepEqual(calls.map(c=>c[0]),['order_clips_by_dialogue.js','join_clips.js']);
  assert(logs.some(t=>t.includes('Audio review warning')));
  assert.equal(fs.readFileSync(path.join(clips,'a.mp4'),'utf8'),'unchanged original');
  const bad=[{...verified,complete:false,missingScenes:[2]}, {...verified,clips:[verified.clips[0],verified.clips[0]]},{...verified,clips:[verified.clips[0],{...verified.clips[1],order_verified:false}]}];
  for(const manifest of bad){
   const seen=[];
   await assert.rejects(fixAndJoin(story,{log:()=>{},run:async(script)=>{seen.push(script);fs.writeFileSync(path.join(clips,'manifest.json'),JSON.stringify(manifest));return 0;}}),/RECOVERY_REVIEW_REQUIRED/);
   assert.deepEqual(seen,['order_clips_by_dialogue.js'],'unresolved, duplicate and uncertain mappings never reach Join');
  }
  const failed=[];await assert.rejects(fixAndJoin(story,{log:()=>{},run:async(s)=>{failed.push(s);return 1;}}),/resolution failed/);assert.equal(failed.length,1);
  console.log('PASS: one action resolves then joins verified story order; audio warning retained; original files preserved; uncertain/duplicate/missing mappings stop without join.');
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
