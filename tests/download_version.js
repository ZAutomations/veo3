const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {execFileSync}=require('child_process');
const {chooseOriginal,chooseUpscaled,videoInfo,verifiedExisting}=require('../single_clip_omni_upscaled');
const options=[{text:'360p Original'},{text:'720p Upscaled'},{text:'1080p Upscaled'}];
assert.equal(chooseOriginal(options,360).text,'360p Original');
assert.equal(chooseUpscaled(options,720).text,'720p Upscaled');
assert.throws(()=>chooseOriginal([{text:'720p Upscaled'}],360),/not found/);
assert.throws(()=>chooseOriginal([{text:'360p Original',disabled:true}],360),/not found/);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'original-download-'));
try{
 const file=path.join(dir,'scene-01.mp4');
 execFileSync('ffmpeg',['-y','-f','lavfi','-i','color=size=360x640:rate=24:duration=1','-c:v','libx264','-pix_fmt','yuv420p',file],{stdio:'ignore',windowsHide:true});
 const info=videoInfo(file,360),job={number:1,prompt:'An exact scene prompt'};
 const entry={file:'scene-01.mp4',project:'p',scene:1,route:'original-360p',sha256:info.sha256,promptHash:crypto.createHash('sha256').update(job.prompt).digest('hex')};
 assert(verifiedExisting(entry,job,dir,'p',false,360,'original'));
 assert(!verifiedExisting(entry,job,dir,'p',false,720,'upscaled'));
 assert(!verifiedExisting({...entry,route:'upscaled-720p'},job,dir,'p',false,360,'original'));
 console.log('PASS: exact Original/Upscaled options; playable original 360p; mode-specific verified-file skipping.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
