// Retry reconciliation: disk content is evidence, filenames/counts are not.
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const read=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return null;}};
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function fingerprint(story){return crypto.createHash('sha256').update(JSON.stringify({scenes:story.scenes,seconds:story.scene_seconds})).digest('hex');}
function verified(storyFile,outDir){
 const story=read(storyFile),out=outDir||path.join(path.dirname(storyFile),'clips');
 const proof=read(path.join(out,'LOCAL_RECOVERY.json'));
 if(!story||proof?.storyHash!==fingerprint(story))return [];
 const entries=proof.clips||[];
 return entries.filter(c=>entries.filter(x=>x.scene===c.scene||x.file===c.file).length===1&&Number.isInteger(c.scene)&&c.scene>0&&c.scene<=story.scenes.length
  &&path.basename(c.file)===c.file&&fs.existsSync(path.join(out,c.file))&&hash(path.join(out,c.file))===c.sha256);
}
async function reconcile(storyFile,{outDir,run,log=()=>{}}={}){
 const story=read(storyFile),out=outDir||path.join(path.dirname(storyFile),'clips');
 if(!story?.scenes?.length||!fs.existsSync(out))return {complete:false,clips:[]};
 const files=fs.readdirSync(out).filter(f=>/\.mp4$/i.test(f));
 if(!files.length)return {complete:false,clips:[]};
 let cached=verified(storyFile,out);
 let manifest=read(path.join(out,'manifest.json'));
 if(cached.length===story.scenes.length&&manifest?.complete===true&&cached.every(c=>manifest.clips?.some(m=>m.file===c.file&&m.matched_scene===c.scene&&m.order_verified===true)))return {complete:true,clips:cached};
 log(`Retry preflight: checking ${files.length} local clip(s) before repeating remote work.`);
 const mapped=new Set((manifest?.clips||[]).filter(c=>c.order_verified&&c.got!==false).map(c=>c.file));
 if(files.some(f=>!mapped.has(f))){
  // Reuse the existing local speech/source order verifier, including its silent-story guard.
  const result=await run('order_clips_by_dialogue.js',[storyFile,'--write'],{timeoutMs:45*60*1000});
  if(result.out&&!result.streamed)log(result.out);
  manifest=read(path.join(out,'manifest.json'));
 }
 const candidates=(manifest?.clips||[]).filter(c=>c.order_verified===true&&c.got!==false&&!c.duplicate
  &&Number.isInteger(c.matched_scene)&&c.matched_scene>0&&c.matched_scene<=story.scenes.length);
 const clips=[];
 for(const c of candidates){
  if(candidates.filter(x=>x.matched_scene===c.matched_scene||x.file===c.file).length!==1||path.basename(c.file)!==c.file)continue;
  const file=path.join(out,c.file);if(!fs.existsSync(file))continue;
  if(c.sha256&&hash(file)!==c.sha256)continue;
  const v=require('./download_media_validation').playableVideo(file);
  const expected=Number(story.scene_seconds||8);
  if(!v.ok||Math.abs(v.duration-expected)>0.8){log(`Scene ${c.matched_scene}: local file failed playback/duration check; not accepted.`);continue;}
  clips.push({scene:c.matched_scene,file:c.file,sha256:hash(file),duration:v.duration,match_from:c.match_from||manifest.orderResolvedBy||'verified_manifest'});
 }
 fs.writeFileSync(path.join(out,'LOCAL_RECOVERY.json'),JSON.stringify({storyHash:fingerprint(story),checkedAt:new Date().toISOString(),clips},null,2)+'\n');
 const complete=clips.length===story.scenes.length;
 log(`Retry preflight: ${clips.length}/${story.scenes.length} local scenes verified; ${complete?'generation and video downloads already complete.':'only unverified/missing scenes still need recovery.'}`);
 return {complete,clips};
}
function runNode(script,args,opts={}){return new Promise((resolve,reject)=>{
 const child=require('child_process').spawn(process.execPath,[path.join(__dirname,script),...args],{cwd:__dirname,windowsHide:true});
 let out='',err='';child.stdout.on('data',b=>{out+=b;process.stdout.write(b);});child.stderr.on('data',b=>{err+=b;process.stderr.write(b);});
 const timer=setTimeout(()=>child.kill(),opts.timeoutMs||45*60*1000);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,out,err,streamed:true});});
 });}
module.exports={reconcile,verified,fingerprint,runNode};
