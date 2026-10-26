const fs=require('fs'),path=require('path'),crypto=require('crypto');
function ownerOf(project,storyFile){
 const id=String(project).match(/\/project\/([\w-]+)/)?.[1];if(!id||!storyFile)return null;
 const selected=path.resolve(storyFile),root=path.dirname(path.dirname(selected));
 if(!fs.existsSync(root))return null;
 const owners=[];
 for(const entry of fs.readdirSync(root,{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const folder=path.join(root,entry.name),checkpoint=path.join(folder,'agent_batches_'+id+'.json');
  if(!fs.existsSync(checkpoint))continue;
  try{const state=JSON.parse(fs.readFileSync(checkpoint,'utf8'));if(state.project!==id||!state.fingerprint)continue;
   for(const name of fs.readdirSync(folder).filter(f=>f.endsWith('_story.json'))){
    const file=path.join(folder,name),raw=fs.readFileSync(file);
    if(crypto.createHash('sha256').update(raw).digest('hex')===state.fingerprint){const story=JSON.parse(raw);owners.push({file,title:story.title||name,total:story.scenes?.length||0});}
   }
  }catch{}
 }
 if(owners.some(o=>o.file===selected))return null;
 return owners.length===1?owners[0]:null;
}
function assertBinding(project,storyFile){const owner=ownerOf(project,storyFile);if(owner)throw Error('STORY_PROJECT_MISMATCH: This project belongs to "'+owner.title+'" ('+owner.total+' clips), but a different story is selected. Select this story before downloading: '+owner.file+'. No clips downloaded or substituted.');}
module.exports={ownerOf,assertBinding};
