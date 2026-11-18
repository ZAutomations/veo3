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
  const silent={narrated:false,audio_first:true,scenes:[{shots:[
   {visual:'Follow the blue marker as it crosses the river and stops beside the northern bridge.'},
   {visual:'Pan to the foothills while the amber marker traces the road to the mountain pass.'}
  ]}]};
  const silentSource=JSON.stringify(silent);
  fs.writeFileSync(file,silentSource);
  const silentManifest={context:{fingerprint:crypto.createHash('sha256').update(silentSource).digest('hex')},total:1,batches:[{from:1,to:1}]};
  const silentSnapshot={...snapshot,mediaTiles:{...snapshot.mediaTiles,ready_video_tile:1,flow_video_tile:1}};
  const media=require('../single_clip_omni_media');
  const naming=require('../agent_video_names');
  const tile={ready:true,assetId:'video-1',text:'Map animation',sourcePrompt:silent.scenes[0].shots.map(s=>s.visual).join('\n')};
  const inspectTiles=tiles=>async(_,jobs)=>({found:{1:media.locateJob(tiles,jobs[0])}});
  const tiles=[{...tile,text:tile.text+'\n'+tile.sourcePrompt}];
  assert.deepEqual(await reconcileSources({},silentSnapshot,silentManifest,0,file,{inspect:inspectTiles(tiles)}),
   {completed:1,verified:[{from:1,to:1}]});
  const targets=[{scene:1,assetId:tile.assetId}];
  assert.equal(naming.plan(silent,targets,[tile])[0].assetId,tile.assetId);
  const captionOnly={...tile,sourcePrompt:''};
  assert.equal(await reconcileSources({},silentSnapshot,silentManifest,0,file,{inspect:inspectTiles([captionOnly])}),null);
  assert.throws(()=>naming.plan(silent,targets,[captionOnly]),/source identity is unverified/);
  await assert.rejects(reconcileSources({},silentSnapshot,silentManifest,0,file,{inspect:inspectTiles([...tiles,{...tiles[0],assetId:'duplicate'}])}),
   /SCENE_ASSET_AMBIGUITY/);
  console.log('PASS: stale 5/7 checkpoint reconciled by exact existing sources; wrong sources, extra clips, pending media and changed stories rejected.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
