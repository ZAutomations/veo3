const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const D=require('../agent_deleted_preflight'),{runAgentBatches}=require('../agent_batches');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deleted-first-'));
 try{
  const file=path.join(dir,'test_story.json');fs.writeFileSync(file,JSON.stringify({scene_seconds:10,scenes:[{},{},{},{}]}));
  const fingerprint=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const project='https://flow.google.com/project/test',stateFile=path.join(dir,'agent_batches_test.json'),submission=stateFile+'.submission.json';
  const state={project:'test',fingerprint,total:4,size:4,completed:0,pending:{from:1,to:1},durationReviewRequired:true,durationExpectedSeconds:10};
  const intent={fingerprint,from:1,to:1,status:'submitting'};
  const empty={agentOn:true,mediaTiles:{project_scan_complete:true,agent_busy:false,ready_video_tile:0,failed_video_tile:0,generating_video_tile:0,flow_video_tile:0}};
  assert(D.eligible(state,intent,empty,project));
  for(const patch of [{ready_video_tile:1},{flow_video_tile:1},{failed_video_tile:1},{generating_video_tile:1},{agent_busy:true},{project_scan_complete:false}])assert(!D.eligible(state,intent,{...empty,mediaTiles:{...empty.mediaTiles,...patch}},project));
  for(const patch of [{completed:1},{durationReviewRequired:false},{pending:{from:1,to:4}},{durationExpectedSeconds:8}])assert(!D.eligible({...state,...patch},intent,empty,project));
  assert(!D.eligible(state,intent,empty,'https://flow.google.com/project/other'));
  fs.writeFileSync(stateFile,JSON.stringify(state));fs.writeFileSync(submission,JSON.stringify(intent));
  let reads=0,waits=0;
  assert(await D.confirm({submissionFile:submission,storyFile:file,projectUrl:project,read:async()=>{reads++;return empty;},wait:async ms=>{assert.equal(ms,8000);waits++;}}));assert.equal(reads,2);assert.equal(waits,1);
  reads=0;assert(!await D.confirm({submissionFile:submission,storyFile:file,projectUrl:project,read:async()=>++reads===1?empty:{...empty,mediaTiles:{...empty.mediaTiles,ready_video_tile:1,flow_video_tile:1}},wait:async()=>{}}));
  fs.writeFileSync(submission+'.missing.json',JSON.stringify({status:'confirmed',numbers:[1]}));
  fs.writeFileSync(submission+'.safety-review.json','{}');
  const generated=[];let auditFails=true;
  const run=async(arg,args)=>{
   if(arg==='agent_duration_check.js')return auditFails?{code:2,err:'CLIP_DURATION_MISMATCH: actual 4s'}:{code:0};
   if(typeof arg==='string'){fs.writeFileSync(args[args.indexOf('--out')+1],'numbered scene prompt');return {code:0};}
   generated.push({retry:arg._retry_only,expected:arg._expected});
   if(generated.length===1)return {ok:false,retrySubmission:true,deletedDurationPreflight:true};
   if(!arg._retry_only)fs.writeFileSync(submission,JSON.stringify({...JSON.parse(fs.readFileSync(submission)),status:'submitting'}));
   return {ok:true,text:'rendered'};
  };
  const options={project_url:project,clip_batch_size:4};
  assert(!(await runAgentBatches(options,file,run,()=>{})).ok);
  assert.deepEqual(generated,[{retry:true,expected:1},{retry:false,expected:1}]);
  let saved=JSON.parse(fs.readFileSync(stateFile));assert.equal(saved.completed,0);assert.equal(saved.pending.to,1);
  assert(!fs.existsSync(submission+'.missing.json'));assert.equal(fs.readdirSync(dir).filter(f=>f.includes('.deleted-first-clip-')).length,2);
  auditFails=false;generated.length=0;
  const verified=async(arg,args)=>{
   if(typeof arg==='object'){generated.push({retry:arg._retry_only,expected:arg._expected});return {ok:true,text:'ready'};}
   return run(arg,args);
  };
  assert((await runAgentBatches(options,file,verified,()=>{})).ok);
  assert.deepEqual(generated,[{retry:true,expected:1},{retry:false,expected:4}]);
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).completed,4);
  console.log('PASS: deleted duration-test Scene 1 requires two full idle inventories; existing/active/unknown scenes block; only first scene resubmits and later scenes wait for actual-duration pass.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
