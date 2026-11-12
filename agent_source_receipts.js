const fs=require('fs'),path=require('path'),crypto=require('crypto'),ids=require('./agent_scene_ids');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const projectId=url=>String(url||'').match(/\/project\/([^/?#]+)/)?.[1];
function fileFor(storyFile,project){const id=projectId(project);if(!/^[a-zA-Z0-9-]+$/.test(id||''))throw Error('Invalid source receipt project');return path.join(path.dirname(path.resolve(storyFile)),`agent_sources_${id}.json`);}
function save(storyFile,project,rows){
 const story=JSON.parse(fs.readFileSync(storyFile,'utf8')),file=fileFor(storyFile,project);
 let old;try{old=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
 const storyHash=hash(storyFile),byScene=new Map(old?.storyHash===storyHash&&old.project===projectId(project)?old.rows.map(r=>[r.scene,r]):[]);
 for(const r of rows){if(!Number.isInteger(r.scene)||r.scene<1||r.scene>story.scenes.length||!r.assetId||!Number.isFinite(r.duration)||r.duration<=0)throw Error('Unverified source receipt');byScene.set(r.scene,{scene:r.scene,sceneId:ids.sceneId(story,r.scene),assetId:r.assetId,duration:r.duration});}
 if(new Set([...byScene.values()].map(r=>r.assetId)).size!==byScene.size)throw Error('Duplicate source receipt asset');
 const value={project:projectId(project),storyHash,verifiedAt:new Date().toISOString(),rows:[...byScene.values()]};fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);
}
function plan(storyFile,project,tiles){
 let saved;try{saved=JSON.parse(fs.readFileSync(fileFor(storyFile,project),'utf8'));}catch{return null;}
 const story=JSON.parse(fs.readFileSync(storyFile,'utf8'));
 if(saved.storyHash!==hash(storyFile)||saved.project!==projectId(project)||saved.rows?.length!==story.scenes.length)return null;
 const used=new Set();return story.scenes.map((scene,i)=>{
  const matches=saved.rows.filter(r=>r.scene===i+1&&r.sceneId===ids.sceneId(story,i+1));if(matches.length!==1)throw Error('RECOVERY_REVIEW_REQUIRED: Source receipt scene conflict.');
  const r=matches[0],hits=tiles.filter(t=>t.assetId===r.assetId||t.assetIds?.includes(r.assetId));
  if(hits.length!==1||hits[0].failed||hits[0].busy||hits[0].ready===false)throw Error('RECOVERY_REVIEW_REQUIRED: Verified scene asset is absent or not unique; no grid-order substitution.');
  const tile=hits[0],own=ids.tileId(tile);if(used.has(tile.assetId)||own&&own!==r.sceneId)throw Error('RECOVERY_REVIEW_REQUIRED: Source receipt conflicts with current asset identities.');used.add(tile.assetId);
  const nativeResolution=/\b360p\b/i.test(tile.text||'')?360:/\b720p\b/i.test(tile.text||'')?720:null;
  return {job:{number:i+1,scene,prompt:scene.veo3_prompt||scene.script_line||'',sceneId:r.sceneId},receipt:{scene:i+1,assetId:tile.assetId,sceneId:r.sceneId,key:'',...(nativeResolution?{nativeResolution,native720:nativeResolution===720}:{}),match_from:'verified_source_receipt'}};
 });
}
module.exports={save,plan,fileFor};
