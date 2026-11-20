'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {assess,verifyDurationBeforeNaming}=require('../agent_duration_check'),{runAgentBatches}=require('../agent_batches');
(async()=>{
 const {markTile}=require('../agent_duration_check');
 const image={currentSrc:'https://example.invalid/thumbnail/resized',getAttribute:name=>name==='src'?'/image/verified-source':null};
 let marked=false;
 const tile={querySelectorAll:()=>[image],setAttribute:()=>{marked=true;}};
 const dom={window:{__singleOmniTileKeys:{keys:new Map([[tile,'tile-1']])}},document:{querySelectorAll:selector=>selector==='flow-video-tile'?[tile]:[]}};
 const mark=require('node:vm').runInNewContext(`(${markTile})`,dom);
 assert.equal(mark({key:'tile-1',assetId:'verified-source'}),true,'raw source must still identify the verified tile');
 assert.equal(marked,true);
 assert.equal(mark({key:'tile-1',assetId:'verified'}),false,'a prefix is not a verified asset ID');
 assert.equal(mark({key:'different-tile',assetId:'verified-source'}),false,'tile key must still match');
 assert.equal(assess([{scene:1,duration:9.963},{scene:2,duration:10.027}],10).length,2);
 assert.throws(()=>assess([{scene:1,duration:4.02}],10),/CLIP_DURATION_MISMATCH/);
 assert.throws(()=>assess([{scene:1,duration:9.5}],10),/CLIP_DURATION_MISMATCH/);
 assert.throws(()=>assess([{scene:2,duration:null}],10),/unverified/);
 let namesAttempted=0;
 await assert.rejects(()=>verifyDurationBeforeNaming([{scene:1,duration:4}],10,async()=>{namesAttempted++;}),/CLIP_DURATION_MISMATCH/);
 assert.equal(namesAttempted,0,'Short media must stop before naming');
 const ready=await verifyDurationBeforeNaming([{scene:1,duration:9.963}],10,async()=>{throw Error('RECOVERY_REVIEW_REQUIRED: SCENE_NAMING_FAILED: read back failed');});
 assert(ready.namingReviewRequired,'Display naming may be deferred only after real duration passes');
 await assert.rejects(()=>verifyDurationBeforeNaming([{scene:1,duration:9.963}],10,async()=>{throw Error('source identity is unverified');}),/source identity/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duration-checkpoint-'));
 try{
  const story=path.join(dir,'story.json');fs.writeFileSync(story,JSON.stringify({scene_seconds:10,scenes:[{},{},{},{}]}));
  const options={project_url:'https://flow.google.com/project/duration-test',clip_batch_size:2};
  let generated=0,audits=0,fail=true;
  const run=async(arg,args)=>{
   if(arg==='agent_duration_check.js'){audits++;assert.equal(args[args.indexOf('--seconds')+1],'10');return fail?{code:2,err:'CLIP_DURATION_MISMATCH: actual 4.02s'}:{code:0};}
   if(typeof arg==='string'){fs.writeFileSync(args[args.indexOf('--out')+1],'prompt');return {code:0};}
   generated++;return {ok:true,text:'ready'};
  };
  const first=await runAgentBatches(options,story,run,()=>{});assert(!first.ok);assert.equal(generated,1);assert.equal(audits,1);
  const checkpoint=path.join(dir,'agent_batches_duration-test.json');const state=JSON.parse(fs.readFileSync(checkpoint));
  assert.equal(state.completed,0);assert.deepEqual([state.pending.from,state.pending.to],[1,1]);
  assert.equal(state.durationReviewRequired,true);
  state.completed=4;state.pending=null;fs.writeFileSync(checkpoint,JSON.stringify(state));generated=0;
  const legacy=await runAgentBatches(options,story,run,()=>{});assert(!legacy.ok);assert.equal(generated,0,'legacy completed state must be audited without resubmission');
  fail=false;assert((await runAgentBatches(options,story,run,()=>{})).ok);assert.equal(generated,0);
  const rows=Array.from({length:4},(_,i)=>({scene:i+1,assetId:`asset-${i+1}`,duration:10}));
  require('../agent_source_receipts').save(story,options.project_url,rows);
  const report={ok:true,sourceVerified:true,project:options.project_url,storyFile:story,from:1,to:4,expectedSeconds:10,rows};
  const savedState=JSON.parse(fs.readFileSync(checkpoint));
  savedState.durationReviewRequired=true; // A later attempt could not mount the grid.
  fs.writeFileSync(checkpoint,JSON.stringify(savedState));
  fs.writeFileSync(checkpoint+'.duration.json',JSON.stringify(report));
  const resume={...options,_resume_download:true};
  const gridTimeout=async script=>{
   assert.equal(script,'agent_duration_check.js','download continuation must not submit generation');
   return {code:2,err:'Waiting for selector `flow-video-tile` failed\n'};
  };
  assert((await runAgentBatches(resume,story,gridTimeout,()=>{})).ok);
  assert.deepEqual(JSON.parse(fs.readFileSync(checkpoint)),savedState);
  fail=true;
  assert(!(await runAgentBatches(resume,story,run,()=>{})).ok,'a reported duration mismatch must still stop');
  for(const patch of [{sourceVerified:false},{expectedSeconds:8},{rows:rows.map(r=>({...r,assetId:'other-'+r.scene}))}]){
   fs.writeFileSync(checkpoint+'.duration.json',JSON.stringify({...report,...patch}));
   assert(!(await runAgentBatches(resume,story,gridTimeout,()=>{})).ok,'invalid proof must still require a successful audit');
  }
  fail=false;
  // A fresh ten-second project renders and audits one real scene before the
  // requested batch size is used for the rest of the story.
  fs.unlinkSync(checkpoint);generated=0;const ranges=[];
  const successRun=async(arg,args)=>{
   if(arg==='agent_duration_check.js'){
    ranges.push([Number(args[args.indexOf('--from')+1]),Number(args[args.indexOf('--to')+1])]);return {code:0};
   }
   return run(arg,args);
  };
  assert((await runAgentBatches(options,story,successRun,()=>{})).ok);
  assert.deepEqual(ranges,[[1,1],[2,4]]);
  assert.equal(generated,2);
  // Existing submitted ranges retain their identities on retry.
  const pendingState=JSON.parse(fs.readFileSync(checkpoint));
  pendingState.completed=0;pendingState.pending={from:1,to:2};
  fs.writeFileSync(checkpoint,JSON.stringify(pendingState));
  fail=true;ranges.length=0;const retried=[];
  const pendingRun=async(arg,args)=>{
   if(typeof arg==='object')retried.push([arg._required_ready+1,arg._expected,arg._retry_only]);
   return run(arg,args);
  };
  assert(!(await runAgentBatches(options,story,pendingRun,()=>{})).ok);
  assert.deepEqual(retried,[[1,2,true]],'do not split/replay an already submitted range to create a new duration test');
  fs.unlinkSync(checkpoint);fs.writeFileSync(story,JSON.stringify({scene_seconds:10,scenes:[{},{},{},{},{},{}]}));
  const released=[];
  const sixRun=async(arg,args)=>{
   if(arg==='agent_duration_check.js')return {code:0,out:'DURATION VERIFIED; display naming pending'};
   if(typeof arg==='string'){fs.writeFileSync(args[args.indexOf('--out')+1],'prompt');return {code:0};}
   assert.equal(arg._duration_verified,arg._required_ready>0,'only audited first render releases concurrent submission');released.push([arg._required_ready+1,arg._expected]);return {ok:true,text:'ready'};
  };
  assert((await runAgentBatches({...options,clip_batch_size:1},story,sixRun,()=>{})).ok);
  assert.deepEqual(released,[[1,1],[2,6]],'A verified first 10-second clip releases exactly the remaining five without replaying scene 1');
  fs.unlinkSync(checkpoint);fs.writeFileSync(story,JSON.stringify({scene_seconds:10,scenes:Array.from({length:13},()=>({}))}));released.length=0;
  assert((await runAgentBatches({...options,clip_batch_size:2},story,sixRun,()=>{})).ok);
  assert.deepEqual(released,[[1,1],[2,13]],'all remaining scenes are released together even when saved batch size is smaller');
  // Missing preview metadata gets one fresh audit, never another generation.
  for(const mode of ['recovered','unknown','mismatch']){
   fs.unlinkSync(checkpoint);let requests=0,submits=0;
   const transientRun=async(arg,args)=>{
    if(arg==='agent_duration_check.js'){
     requests++;
     if(mode==='mismatch')return {code:2,err:'CLIP_DURATION_MISMATCH: actual 4.00s'};
     if(mode==='unknown'||requests===1)return {code:2,err:'RECOVERY_REVIEW_REQUIRED: CLIP_DURATION_UNVERIFIED: actual unverified'};
     return {code:0};
    }
    if(typeof arg==='string'){fs.writeFileSync(args[args.indexOf('--out')+1],'prompt');return {code:0};}
    submits++;return {ok:true,text:'ready'};
   };
   const outcome=await runAgentBatches(options,story,transientRun,()=>{});
   assert.equal(outcome.ok,mode==='recovered');
   assert.equal(submits,mode==='recovered'?2:1,'metadata recovery cannot replay a submitted batch');
   assert.equal(requests,mode==='recovered'?3:mode==='unknown'?2:1,'only unknown metadata gets one extra audit');
  }
  console.log('PASS: short/unknown clips cannot advance a checkpoint or release the next batch; old completed checkpoints are audited without regeneration; normal frame rounding accepted.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
