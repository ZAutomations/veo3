const fs=require('fs'),path=require('path'),crypto=require('crypto');
function receiptFor(project,ref,root=path.join(__dirname,'logs','reference_recovery')){
 const key=crypto.createHash('sha256').update(JSON.stringify({project,name:ref.name,prompt:ref.prompt})).digest('hex');
 const file=path.join(root,key+'.json');
 return {
  name:String(ref.name||''),
  read(){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return null}},
  write(record){fs.mkdirSync(root,{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify({...record,referenceName:String(ref.name||''),project,promptHash:crypto.createHash('sha256').update(String(ref.prompt||'')).digest('hex')}));fs.renameSync(tmp,file)},
  clear(){try{fs.unlinkSync(file)}catch(e){if(e.code!=='ENOENT')throw e}}
 };
}
async function recoverPending(page,receipt,seconds,RI,log){
 const pending=receipt.read();if(!pending)return null;
 if(pending.status==='completed'){
  const state=await page.evaluate(RI.referenceState);
  const image=state.images.find(im=>im.key===pending.imageKey);
  // The caller audits the full grid first. A receipt alone is not proof that
  // this image still exists (it may have been removed or manually replaced).
  if(image)return {ok:true,alreadyNamed:true,tileIndex:image.tileIndex,imageKey:image.key};
  return {ok:false,why:`RECOVERY_REVIEW_REQUIRED: Saved ${receipt.name} image is not verified in the project; no duplicate submitted. Check or rename the intended existing image and retry.`};
 }
 if(pending.status==='review'){
  log(`Previous ${receipt.name} request was parked for review; a manual Retry / Continue will start one fresh request if no correctly named tile exists.`);
  return null;
 }
 log('Resuming the previously submitted reference image; checking for late completion without submitting another prompt.');
 const result=await RI.waitForReferenceImage(page,pending.before,seconds);
 if(!result.ok && /no completed reference image/i.test(result.why||'')){
  receipt.write({...pending,status:'review',reviewedAt:new Date().toISOString()});
  return {...result,why:`RECOVERY_REVIEW_REQUIRED: ${receipt.name} has no matching completed image after ${seconds}s. The pending receipt is parked to stop automatic retry loops. If its uploaded image is in Flow, rename that tile exactly "${receipt.name}" and Retry / Continue; otherwise Retry / Continue once to submit a fresh image.`};
 }
 return result;
}
module.exports={receiptFor,recoverPending};
