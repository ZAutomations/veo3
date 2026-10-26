const fs=require('fs'),path=require('path'),crypto=require('crypto');
function receiptFor(project,ref,root=path.join(__dirname,'logs','reference_recovery')){
 const key=crypto.createHash('sha256').update(JSON.stringify({project,name:ref.name,prompt:ref.prompt})).digest('hex');
 const file=path.join(root,key+'.json');
 return {
  read(){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return null}},
  write(record){fs.mkdirSync(root,{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(record));fs.renameSync(tmp,file)},
  clear(){try{fs.unlinkSync(file)}catch(e){if(e.code!=='ENOENT')throw e}}
 };
}
async function recoverPending(page,receipt,seconds,RI,log){
 const pending=receipt.read();if(!pending)return null;
 if(pending.status==='completed'){
  const state=await page.evaluate(RI.referenceState);
  if(state.images.some(im=>im.key===pending.imageKey))return {ok:true,alreadyNamed:true};
  return {ok:false,why:'No completed reference image after '+seconds+'s. Saved reference is not currently verifiable; no duplicate submitted.'};
 }
 log('Resuming the previously submitted reference image; checking for late completion without submitting another prompt.');
 return RI.waitForReferenceImage(page,pending.before,seconds);
}
module.exports={receiptFor,recoverPending};
