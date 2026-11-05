const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {UpscaledDownloader,videoInfo}=require('./single_clip_omni_upscaled');
function plan(tiles,story){
 const named=require('./agent_scene_ids').plan(tiles,story);if(named)return named;
 const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 return story.scenes.map((scene,i)=>{
  const lines=scene.dialogue?.length?scene.dialogue.map(d=>d.line):[scene.script_line];
  const needles=require('./silent_scene_identity').needles(scene);
  if(!needles.length||needles.join('').length<20)throw Error(`Scene ${i+1}: insufficient source text for reliable clip matching.`);
  const hits=tiles.filter(t=>t.assetId&&needles.every(n=>norm(t.prompt||t.text).includes(n))).sort((a,b)=>a.index-b.index);
  if(!hits.length)throw Error(`Scene ${i+1}: completed matching source not found. Upscaled download stopped without substituting another scene.`);
  if(new Set(hits.map(t=>t.assetId)).size!==1)throw Error(`Scene ${i+1}: multiple matching video tiles; scene order must be resolved from narration.`);
  const metadata=String(hits[0].text||hits[0].prompt||'').split(/Created\s/i).pop();
  return {job:{number:i+1,scene,prompt:String(scene.veo3_prompt||lines.join('\n'))},receipt:{scene:i+1,assetId:hits[0].assetId,key:'',nativeResolution:/\b360p\b/i.test(metadata)?360:720,native720:/\b720p\b/i.test(metadata)&&!/\b360p\b/i.test(metadata),match_from:'verified_source_prompt'}};
 });
}
function assetPlan(tiles,story,storyFile,project){
 const total=story.scenes.length,id=project.match(/\/project\/([^/?#]+)/)?.[1];
 if(!id)return null;
 const stateFile=path.join(path.dirname(storyFile),`agent_batches_${id}.json`);
 if(!fs.existsSync(stateFile))return null;
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 const fingerprint=crypto.createHash('sha256').update(fs.readFileSync(storyFile)).digest('hex');
 // A download can be requested while a batch is incomplete, and retries can
 // leave several ready assets carrying the same scene ID. The checkpoint
 // authenticates the project/story association; each distinct ready asset is
 // safe to preserve, but none may be assigned a scene number from grid order.
 if(state.project!==id||state.fingerprint!==fingerprint||state.total!==total)return null;
 if(!Array.isArray(tiles)||tiles.length===0||tiles.some(t=>t.failed||t.busy||t.ready===false||!t.assetId))return null;
 const sceneIds=require('./agent_scene_ids'),expectedIds=new Set(Array.from({length:total},(_,i)=>sceneIds.sceneId(story,i+1)));
 // A differently tagged video suggests a mixed/incorrect project. Untagged
 // assets are retained because Flow can omit a title after a retry.
 if(tiles.some(t=>{const found=sceneIds.tileId(t);return found&&!expectedIds.has(found);}))return null;
 const distinct=new Map(tiles.map(t=>[t.assetId,t]));
 return [...distinct.values()].sort((a,b)=>Number.isFinite(a.index)&&Number.isFinite(b.index)?a.index-b.index:a.assetId.localeCompare(b.assetId)).map((t,i)=>{
  const nativeResolution=/\b360p\b/i.test(t.text||'')?360:720;
  return {job:{number:i+1,scene:{},prompt:`AGENT ASSET ID: ${t.assetId}`},receipt:{assetId:t.assetId,key:'',nativeResolution,native720:nativeResolution===720,sourceSceneId:sceneIds.tileId(t)||null}};
 });
}
function adoptVerified(d,entries,downloadVersion,priorFile,expectedHash){
 if(!fs.existsSync(priorFile))return;
 const prior=JSON.parse(fs.readFileSync(priorFile,'utf8'));
 if(prior.storyHash!==expectedHash||prior.project!==d.project)return;
 for(const e of entries){
  if(d.ledger.clips.some(c=>c.scene===e.job.number))continue;
  const old=prior.clips.find(c=>c.assetId===e.receipt.assetId);
  if(!old)continue;
  const target=downloadVersion==='original'?e.receipt.nativeResolution:e.receipt.native720?1080:720;
  if(old.route!==`${downloadVersion}-${target}p`)continue;
  try{
   const source=path.join(d.out,old.file),info=videoInfo(source,target);if(info.sha256!==old.sha256)continue;
   const file=`scene-${String(e.job.number).padStart(2,'0')}.mp4`,dest=path.join(d.out,file);
   if(fs.existsSync(dest)&&crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')!==info.sha256){
    const backup=path.join(d.out,'_replaced');fs.mkdirSync(backup,{recursive:true});fs.renameSync(dest,path.join(backup,`${Date.now()}_${file}`));
   }
   if(!fs.existsSync(dest))fs.copyFileSync(source,dest);
   if(crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')!==info.sha256)throw Error('scene copy hash mismatch');
   if(path.basename(old.file).startsWith('asset-')&&fs.existsSync(source)){
    const backup=path.join(d.out,'_asset_name_backup');fs.mkdirSync(backup,{recursive:true});
    const moved=path.join(backup,path.basename(old.file));if(!fs.existsSync(moved))fs.renameSync(source,moved);
   }
   d.ledger.clips.push({...old,file,scene:e.job.number,sceneId:e.receipt.sceneId||null,
    promptHash:crypto.createHash('sha256').update(e.job.prompt).digest('hex'),match_from:e.receipt.match_from||'verified_source_inspection'});
  }catch{}
 }
}
async function completePartialSceneIds(browser,page,project,tiles,story,log){
 const sceneIds=require('./agent_scene_ids'),partial=sceneIds.partialPlan(tiles,story);
 if(!partial.entries.length||!partial.missing.length)return null;
 log(`Scene-ID download mapping is partial (${partial.entries.length}/${story.scenes.length}); checking source prompts read-only for the remaining ${partial.missing.length} scene(s).`);
 const jobs=partial.missing.map(number=>{const scene=story.scenes[number-1];return {number,scene,prompt:scene.veo3_prompt||scene.script_line||'',silentVisual:require('./silent_scene_identity').isSilent(story)};});
 const inspected=await require('./single_clip_omni_recovery').inspectProject({browser,page,projectUrl:project},jobs,{}, {log,page,sourceCache:new Map()});
 const used=new Set(partial.entries.map(e=>e.receipt.assetId)),byNumber=new Map();
 for(const job of jobs){
  const found=inspected.found?.[job.number];
  if(!found?.ready||!found.assetId||used.has(found.assetId))throw Error(`RECOVERY_REVIEW_REQUIRED: Scene ${job.number} source prompt did not resolve to one unique completed asset; no scene filenames assigned.`);
  const tile=tiles.find(t=>t.assetId===found.assetId);
  if(!tile||tile.failed||tile.busy||tile.ready===false)throw Error(`RECOVERY_REVIEW_REQUIRED: Scene ${job.number} inspection result is absent from the completed project inventory.`);
  used.add(found.assetId);
  const metadata=String(tile.text||tile.prompt||'');
  const nativeResolution=/\b360p\b/i.test(metadata)?360:/\b720p\b/i.test(metadata)?720:null;
  byNumber.set(job.number,{job:{number:job.number,scene:job.scene,prompt:job.prompt,sceneId:null},receipt:{scene:job.number,sceneId:null,assetId:found.assetId,key:'',...(nativeResolution?{nativeResolution,native720:nativeResolution===720}:{}),match_from:'verified_source_prompt'}});
 }
 const all=[...partial.entries,...byNumber.values()].sort((a,b)=>a.job.number-b.job.number);
 if(all.length!==story.scenes.length||all.some((entry,i)=>entry.job.number!==i+1))throw Error('RECOVERY_REVIEW_REQUIRED: Mixed scene-ID/source mapping is incomplete.');
 log(`Verified mixed mapping: ${partial.entries.length} scene IDs plus ${byNumber.size} exact source-prompt matches. Scene filenames are safe to use.`);
 return all;
}
async function download(browser,page,{storyFile,outDir,project,tiles,thumbnailTile=null,thumbnailRequired=false,thumbnailOutputDir=null,downloadVersion='upscaled',log=()=>{}}){
 if(!storyFile||!fs.existsSync(storyFile))throw Error('Upscaled Agent download needs the story JSON to map scenes safely.');
 const story=JSON.parse(fs.readFileSync(storyFile,'utf8'));
 const silent=require('./silent_scene_identity').isSilent(story);
 const sceneIds=require('./agent_scene_ids');
 let entries=null,idConflict=null,unresolved=false,partialIds=false;
 try{entries=sceneIds.plan(tiles,story);}catch(error){idConflict=error;}
 if(idConflict)log(`Scene-ID mapping is ambiguous (${idConflict.message}). Preserving unique assets without assigning scene numbers.`);
 if(entries)log('Verified scene IDs map each completed video asset to its story scene. No transcription or video analysis needed.');
 if(!entries&&!idConflict){
  const partial=sceneIds.partialPlan(tiles,story);partialIds=partial.entries.length>0;
  if(partialIds)try{entries=await completePartialSceneIds(browser,page,project,tiles,story,log);}
  catch(error){log(`Partial scene-ID recovery could not safely resolve all scenes: ${error.message}`);}
 }
 if(partialIds&&!entries)throw Error('RECOVERY_REVIEW_REQUIRED: Some Flow tiles have valid scene IDs but the remaining clip sources could not be verified. Download stopped before assigning ambiguous asset filenames. Retry after Flow exposes the missing source prompts.');
 if(!entries&&silent){
  try{entries=plan(tiles,story);}catch(error){
   log('Silent story: matching timed visual actions, not narration. Reading original source prompts without generating clips.');
   const jobs=story.scenes.map((scene,i)=>({number:i+1,scene,prompt:scene.veo3_prompt||'',silentVisual:true}));
   try{
    const result=await require('./single_clip_omni_recovery').inspectProject({browser,page,projectUrl:project},jobs,{}, {log,page,sourceCache:new Map()});
    entries=plan(result.tiles.map((t,index)=>({...t,index,prompt:t.sourcePrompt||t.text})),story);
   }catch(inspectError){
    entries=assetPlan(tiles,story,storyFile,project);
    if(!entries)throw Error('RECOVERY_REVIEW_REQUIRED: Silent scene identity could not be verified and the completed project inventory/checkpoint does not authorize asset collection. '+inspectError.message);
    unresolved=true;
    log('All completed assets and the story checkpoint are verified. Saving each unique silent video once; scene order remains unverified. No narration matching or grid-order guessing.');
   }
  }
 }
 if(!silent&&!entries)try {entries=plan(tiles,story);} catch(error) {
  if(!/completed matching source not found|multiple matching video tiles|insufficient source text|multiple completed video assets|One video asset claims/.test(error.message))throw error;
  entries=assetPlan(tiles,story,storyFile,project);
  if(entries){
   unresolved=true;
   log('Completed Agent batch checkpoint and full asset inventory verified. Downloading each unique video asset once; scene order will be resolved from its narration, not the shared batch prompt.');
  }else{
  log('Grid captions omit the source prompts; reading original prompts in an inspection tab to map downloads.');
  const jobs=story.scenes.map((scene,i)=>({number:i+1,scene,prompt:scene.veo3_prompt||scene.script_line||''}));
  const result=await require('./single_clip_omni_recovery').inspectProject({browser,page,projectUrl:project},jobs,{}, {log});
  if(!jobs.every(job=>result.found[job.number]?.ready))throw Error('Not every story scene has a verified completed source. No unrelated clip substituted.');
  const ids=jobs.map(job=>result.found[job.number].assetId);
  if(ids.some(id=>!id)||new Set(ids).size!==jobs.length)throw Error('Scene source identities are missing or ambiguous. No download substituted.');
  entries=plan(result.tiles.map((t,index)=>({...t,index,prompt:t.sourcePrompt||t.text})),story);
  }
 }
 // Source inspection may omit the resolution badge. Preserve the metadata
 // from this asset's original grid tile rather than treating absence as 720p.
 for(const e of entries){const original=tiles.find(t=>t.assetId===e.receipt.assetId),badge=String(original?.text||'').match(/\b(360|720)p\b/i);if(badge){e.receipt.nativeResolution=Number(badge[1]);e.receipt.native720=e.receipt.nativeResolution===720;}}
 const jobs=entries.map(e=>e.job),receipts=Object.fromEntries(entries.map(e=>[e.job.number,e.receipt]));
 const folder=path.dirname(path.resolve(storyFile));
 const d=new UpscaledDownloader({browser,page,projectUrl:project},{folder,outDir,total:jobs.length,ledgerPrefix:`agent_${downloadVersion}${unresolved?'_assets':''}`,downloadVersion,orderMode:unresolved?'unresolved-assets':'scene',useExistingPage:true,upscaleFromSource:downloadVersion==='upscaled',storyHash:crypto.createHash('sha256').update(unresolved?fs.readFileSync(storyFile):JSON.stringify(jobs.map(j=>j.prompt))).digest('hex'),log});
 if(unresolved){
  const priorHash=crypto.createHash('sha256').update(JSON.stringify(story.scenes.map(s=>s.veo3_prompt||s.script_line||''))).digest('hex');
  adoptVerified(d,entries,downloadVersion,path.join(folder,`agent_${downloadVersion}_${project.split('/project/')[1]}.json`),priorHash);
 }else{
  const priorHash=crypto.createHash('sha256').update(fs.readFileSync(storyFile)).digest('hex');
  adoptVerified(d,entries,downloadVersion,path.join(folder,`agent_${downloadVersion}_assets_${project.split('/project/')[1]}.json`),priorHash);
 }
 try{
  await d.group(jobs,receipts);
  d.save();
  if(thumbnailRequired){
   const target=thumbnailOutputDir||folder;
   const downloaded=await require('./flow_thumbnail_download').downloadThumbnail(page,thumbnailTile,target,log);
   fs.writeFileSync(path.join(target,'thumbnail_downloaded.json'),JSON.stringify({assetId:thumbnailTile.assetId,file:path.basename(downloaded),downloadedAt:new Date().toISOString()},null,2)+'\n');
  }
  if(silent&&unresolved){
   fs.writeFileSync(path.join(d.out,'CLIP_ORDER.txt'),'SILENT STORY: all verified video assets saved. Scene order needs visual/source review; music and meows cannot establish order.\n'+story.scenes.map((s,i)=>`Scene ${i+1}: ${s.shots?.map(v=>v.visual).join(' ')||s.narrative_context||''}`).join('\n')+'\n');
  }
  log(unresolved?`Agent ${downloadVersion} assets downloaded and verified. Scene order is pending ${silent?'visual/source review':'narration matching'} before joining.`:`Agent ${downloadVersion} clips saved in verified story order.`);
 }finally{await d.close();}
}
module.exports={plan,assetPlan,adoptVerified,completePartialSceneIds,download};
