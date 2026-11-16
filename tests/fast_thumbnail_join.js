const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'join-card-'));
const clips=path.join(temp,'clips');
const tool=path.resolve(__dirname,'../join_clips.js');
const ff=args=>execFileSync('ffmpeg',['-v','error','-y',...args],{encoding:'utf8'});
const env={...process.env,VEO_EDITING_SETTINGS:'{"editing_auto_apply":false}'};
const manifest={expected:2,complete:true,clips:[
 {file:'scene-02.mp4',matched_scene:1,order_verified:true,got:true},
 {file:'scene-01.mp4',matched_scene:2,order_verified:true,got:true},
]};
function clip(name,color,rate){
 ff(['-f','lavfi','-i',`color=${color}:s=128x224:r=24`,'-f','lavfi','-i',`anullsrc=r=${rate}:cl=stereo`,
  '-t','1','-pix_fmt','yuv420p','-c:v','libx264','-c:a','aac',path.join(clips,name)]);
}
try {
 fs.mkdirSync(clips);
 clip('scene-01.mp4','red',48000);
 clip('scene-02.mp4','blue',48000);
 fs.writeFileSync(path.join(clips,'manifest.json'),JSON.stringify(manifest));
 ff(['-f','lavfi','-i','testsrc2=s=320x568','-frames:v','1',path.join(temp,'thumbnail_downloaded.png')]);
 const output=path.join(temp,'join.mp4');
 const join=()=>execFileSync(process.execPath,[tool,clips,'--out',output],{encoding:'utf8',env,timeout:90000});
 const fast=join();
 assert.match(fast,/compatible story clips will be stream-copied/);
 assert.match(fast,/verify copied audio\/video/);
 const report=fs.readFileSync(path.join(temp,'JOINED_CLIP_ORDER.txt'),'utf8');
 assert.match(report,/0\.00s \| scene-02\.mp4[\s\S]*1\.00s \| scene-01\.mp4[\s\S]*2\.00s \| .*thumbnail end card/);
 clip('scene-01.mp4','red',44100);
 const fallback=join();
 assert.match(fallback,/normalize incompatible/);
 assert.match(fallback,/encode: ffmpeg/);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(clips,'manifest.json'),'utf8')),manifest);
 console.log('PASS: compatible end-card copy, verified scene order, and mismatched-audio fallback.');
} finally {
 fs.rmSync(temp,{recursive:true,force:true});
}
