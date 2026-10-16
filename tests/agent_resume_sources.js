const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {reconcileSources}=require('../agent_batch_reconcile');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-resume-'));
 try{
  const file=path.join(dir,'story.json');
  const scenes=Array.from({length:7},(_,i)=>({script_line:`This is the unique narration for scene number ${i+1}, which must match its own source exactly.`}));
  const source=JSON.stringify({scenes}); fs.writeFileSync(file,source);
  const manifest={context:{fingerprint:crypto.createHash('sha256').update(source).digest('hex')},total:7,batches:[{from:1,to:5},{from:6,to:7}]};
  const snapshot={agentOn:true,mediaTiles:{ready_video_tile:7,flow_video_tile:7,project_scan_complete:true,failed_video_tile:0,generating_video_tile:0}};
  let calls=0;
  const inspect=async(_,jobs)=>{calls++;return {found:Object.fromEntries(jobs.map(j=>[j.number,{ready:true,assetId:`video-${j.number}`,text:j.scene.script_line}]))};};
  assert.deepEqual(await reconcileSources({},snapshot,manifest,5,file,{inspect}),{completed:7,verified:[{from:6,to:7}]});
  assert.equal(calls,1);
  const wrong=async()=>({found:{6:{ready:true,assetId:'six',text:'Unrelated source'},7:{ready:true,assetId:'seven',text:scenes[6].script_line}}});
  assert.equal(await reconcileSources({},snapshot,manifest,5,file,{inspect:wrong}),null);
  assert.equal(await reconcileSources({}, {...snapshot,mediaTiles:{...snapshot.mediaTiles,ready_video_tile:8,flow_video_tile:8}},manifest,5,file,{inspect}),null);
  assert.equal(await reconcileSources({}, {...snapshot,mediaTiles:{...snapshot.mediaTiles,generating_video_tile:1}},manifest,5,file,{inspect}),null);
  assert.equal(await reconcileSources({},snapshot,{...manifest,context:{fingerprint:'changed'}},5,file,{inspect}),null);
  assert.equal(calls,1,'unsafe counts/state/story must not start inspection');
  console.log('PASS: stale 5/7 checkpoint reconciled by exact existing sources; wrong sources, extra clips, pending media and changed stories rejected.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
