const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const recovery=require('../agent_missing_scenes'),media=require('../single_clip_omni_media');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'veo-retry-owner-')),file=path.join(dir,'submission.json');
try{
 assert.equal(recovery.recoveryOwnsRetries(file),null);
 fs.writeFileSync(file,JSON.stringify({from:1,to:6}));
 for(const status of ['submitting','confirmed']){
  fs.writeFileSync(file+'.missing.json',JSON.stringify({status,numbers:[3,4,5,6]}));
  assert.equal(recovery.recoveryOwnsRetries(file).status,status,'accepted recovery must still block the original tile retry path');
 }
 fs.writeFileSync(file,JSON.stringify({from:7,to:12}));
 assert.equal(recovery.recoveryOwnsRetries(file),null,'a previous batch must not own the next batch');
 fs.writeFileSync(file+'.missing.json','broken json');
 assert.throws(()=>recovery.recoveryOwnsRetries(file),/RECOVERY_REVIEW_REQUIRED/);
 const sceneId='V3_399ee71b4a45_S003',job={number:3,sceneId};
 const tiles=['original','revised'].map(assetId=>({assetId,text:'SCENE ASSET ID: '+sceneId,ready:true}));
 assert.throws(()=>media.locateJob(tiles,job),/RECOVERY_REVIEW_REQUIRED: SCENE_ASSET_AMBIGUITY/);
 assert.equal(media.locateJob(tiles,job,{assetId:'revised'}),tiles[1],'an explicit verified asset choice remains usable');
 console.log('PASS: confirmed recovery retains retry ownership; later batches remain independent; duplicate versions require review.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
