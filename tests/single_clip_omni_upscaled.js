const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {execFileSync}=require('child_process');
const {chooseUpscaled,videoInfo,verifiedExisting}=require('../single_clip_omni_upscaled');
const {locateJob,stateFor}=require('../single_clip_omni_media');
const job={number:1,prompt:'Prompt 1'};
const tiles=[{key:'a',text:'Prompt 10',ready:true},{key:'b',text:'Prompt 1',ready:true}];
assert.equal(locateJob(tiles,job).key,'b');
assert.throws(()=>locateJob([...tiles,{key:'c',text:'Prompt 1'}],job),/multiple/);
assert.equal(locateJob([...tiles,{key:'c',text:'Prompt 1'}],job,{excluded:['b']}).key,'c');
assert.equal(chooseUpscaled([{text:'360p Original'},{text:'720p Upscaled'}]).text,'720p Upscaled');
assert.throws(()=>chooseUpscaled([{text:'720p Original'}]),/not found/);
assert.throws(()=>chooseUpscaled([{text:'720p Original'},{text:'1080p Upscaled'}]),/not found/);
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'omni-upscale-test-'));
try{
 for(const size of ['1280x720','640x360']){
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=c=black:s=${size}:r=10`,'-t','0.2','-c:v','libx264','-preset','ultrafast',path.join(folder,size+'.mp4')],{windowsHide:true,timeout:30000});
 }
 const info=videoInfo(path.join(folder,'1280x720.mp4'));
 assert.equal(info.width,1280);assert.equal(info.height,720);
 assert.throws(()=>videoInfo(path.join(folder,'640x360.mp4')),/not 720p/);
 const entry={file:'1280x720.mp4',scene:1,project:'project',route:'upscaled-720p',sha256:info.sha256,promptHash:crypto.createHash('sha256').update(job.prompt).digest('hex')};
 assert(verifiedExisting(entry,job,folder,'project'));
 assert(!verifiedExisting(entry,job,folder,'other-project'));
 assert(!verifiedExisting({...entry,route:'original'},job,folder,'project'));
 fs.appendFileSync(path.join(folder,'1280x720.mp4'),'changed');
 assert(!verifiedExisting(entry,job,folder,'project'));
 console.log('PASS: exact scene matching, no ambiguous substitute, Upscaled-only 720p menu, real video decoding/resolution, verified-file skipping.');
}finally{fs.rmSync(folder,{recursive:true,force:true});}
