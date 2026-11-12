'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process');
const recovery=require('../local_clip_recovery');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retry-local-')),out=path.join(root,'clips'),storyFile=path.join(root,'story.json');
 fs.mkdirSync(out);const story={scene_seconds:4,scenes:[{script_line:'First distinctive narration.'},{script_line:'Second distinctive narration.'}]};
 fs.writeFileSync(storyFile,JSON.stringify(story));
 try{
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=128x128:d=4','-c:v','libx264','-y',path.join(out,'manual-random.mp4')],{windowsHide:true});
  let runs=0;
  const run=async()=>{runs++;fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({complete:false,clips:[{file:'manual-random.mp4',matched_scene:2,order_verified:true,match_from:'script_line'}]}));return {code:0,out:''};};
  const partial=await recovery.reconcile(storyFile,{run});
  assert.equal(runs,1);assert.equal(partial.complete,false);assert.deepEqual(partial.clips.map(c=>c.scene),[2]);
  const {UpscaledDownloader}=require('../single_clip_omni_upscaled');
  const downloader=new UpscaledDownloader({projectUrl:'https://flow.google.com/project/local-test'}, {folder:root,outDir:out,total:2,storyHash:'test'});
  downloader.localRecovery=partial.clips;
  downloader.open=async()=>{throw Error('Manual clip must not open a download tab');};
  const accepted=await downloader.download({number:2,prompt:'Second distinctive narration.'},{sceneId:'verified-scene-2'});
  assert.equal(accepted.file,'manual-random.mp4');assert.equal(accepted.route,'verified-local-manual');
  fs.copyFileSync(path.join(out,'manual-random.mp4'),path.join(out,'another-random.mp4'));
  const complete=await recovery.reconcile(storyFile,{run:async()=>{fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({complete:true,clips:[
   {file:'manual-random.mp4',matched_scene:2,order_verified:true},{file:'another-random.mp4',matched_scene:1,order_verified:true}]}));return {code:0};}});
  assert.equal(complete.complete,true);
  assert.equal((await recovery.reconcile(storyFile,{run:async()=>{throw Error('Repeated completed work');}})).complete,true);
  fs.appendFileSync(path.join(out,'manual-random.mp4'),'changed');assert.equal(recovery.verified(storyFile).length,1);
  fs.writeFileSync(storyFile,JSON.stringify({...story,scene_seconds:10}));assert.equal(recovery.verified(storyFile).length,0);
  const wrongDuration=await recovery.reconcile(storyFile,{run});assert.equal(wrongDuration.complete,false);assert.equal(wrongDuration.clips.length,0);
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({clips:[]}));
  const unproven=await recovery.reconcile(storyFile,{run:async()=>({code:2})});assert.equal(unproven.clips.length,0,'count/names alone never establish scenes');
  console.log('local retry recovery: content mapping, partial adoption, unchanged retry, changed files/story and duration guards passed');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
