'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
// Only an explicit, source-bound receipt can approve a manually supplied file.
// A filename or a single untracked MP4 is never proof of source identity.
function find(folder,out,project,storyHash,assetId,requestedVersion){
 try{
  const data=JSON.parse(fs.readFileSync(path.join(folder,'MANUAL_DOWNLOAD_RECEIPTS.json'),'utf8'));
  if(data.project!==project||data.storyHash!==storyHash)return null;
  const matches=(data.clips||[]).filter(c=>c.assetId===assetId&&c.acceptedFor===requestedVersion&&c.userConfirmedSource===true);
  if(matches.length!==1)return null;
  const item=matches[0],file=path.resolve(out,item.file);
  if(path.dirname(file)!==path.resolve(out)||!fs.existsSync(file))return null;
  if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==item.sha256)return null;
  return {...item,path:file};
 }catch{return null;}
}
module.exports={find};
