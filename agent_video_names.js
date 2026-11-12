'use strict';
const media=require('./single_clip_omni_media'),ids=require('./agent_scene_ids'),bg=require('./single_clip_omni_background');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function plan(story,targets,inventory){
 const scenes=new Set(),assets=new Set();
 return targets.map(t=>{
  if(!Number.isInteger(t.scene)||t.scene<1||t.scene>story.scenes.length||!t.assetId||scenes.has(t.scene)||assets.has(t.assetId))throw Error('RECOVERY_REVIEW_REQUIRED: Scene naming requires unique verified source mappings; no grid-order naming.');
  scenes.add(t.scene);assets.add(t.assetId);const sceneId=ids.sceneId(story,t.scene);
  const own=inventory.find(x=>x.assetId===t.assetId||x.assetIds?.includes(t.assetId));
  if(!own?.ready||own.failed||own.busy)throw Error(`RECOVERY_REVIEW_REQUIRED: Scene ${t.scene} source is not a ready video; no rename.`);
  const job={number:t.scene,scene:story.scenes[t.scene-1],sceneId,prompt:story.scenes[t.scene-1].veo3_prompt||story.scenes[t.scene-1].script_line||''};
  if(!media.promptMatches({...own,text:[own.text,own.sourcePrompt].filter(Boolean).join('\n')},job))throw Error(`RECOVERY_REVIEW_REQUIRED: Scene ${t.scene} source identity is unverified; no title assigned from grid order.`);
  const titleIDs=ids.ids(own.assetTitle||own.assetName||'');
  if(titleIDs.some(id=>id!==sceneId))throw Error(`RECOVERY_REVIEW_REQUIRED: Scene ${t.scene} video already has another scene identity; no rename.`);
  if(inventory.some(x=>x.assetId!==own.assetId&&ids.ids(x.assetTitle||x.assetName||'').includes(sceneId)))throw Error(`RECOVERY_REVIEW_REQUIRED: ${sceneId} already belongs to another video; no duplicate ID assigned.`);
  return {...t,sceneId};
 });
}
async function locate(page,assetId){
 await page.evaluate(require('./flow_grid_scroll').installGridScroller);
 await page.evaluate(bg.scrollToPosition,0);await wait(150);
 for(let n=0;n<100;n++){
  const t=(await media.snapshot(page)).find(t=>t.assetId===assetId||t.assetIds?.includes(assetId));
  if(t)return t;
  const before=await page.evaluate(bg.metrics);if(before.top>=before.scroll-before.client-2)break;
  await page.evaluate(bg.scrollToPosition,before.top+Math.max(120,Math.floor(before.client*0.7)));await wait(250);
  const after=await page.evaluate(bg.metrics);if(after.top<=before.top+2)break;
 }
 throw Error('RECOVERY_REVIEW_REQUIRED: Verified video source is not mounted; no other tile renamed.');
}
async function rename(page,assetId,title){
 for(let n=0;n<5;n++){if(!await page.evaluate(bg.closeMenus))break;await wait(100);}
 const live=await locate(page,assetId);if(live.assetTitle===title)return;
 if(!live.ready||live.failed||live.busy)throw Error('RECOVERY_REVIEW_REQUIRED: Video is not ready for naming.');
 const opened=await page.evaluate(bg.openClipMenu,live);if(!opened.ok||opened.direct)throw Error('RECOVERY_REVIEW_REQUIRED: Verified video Rename menu unavailable.');
 let item;
 for(let n=0;n<20&&!item;n++){item=(await page.evaluate(require('./single_clip_omni_upscaled').menuItems)).find(i=>/\bRename\s*$/i.test(i.text)&&!i.disabled);if(!item)await wait(150);}
 if(!item||!await page.evaluate(bg.clickMenuText,item.text))throw Error('RECOVERY_REVIEW_REQUIRED: No unique active Rename item for this video.');
 const selector='.rename-tile-overlay input.editable-text-input, .rename-tile-overlay input';
 await page.waitForSelector(selector,{visible:true,timeout:10000});
 await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.type(title);
 const committed=await page.evaluate(want=>{
  const root=document.querySelector('.rename-tile-overlay'),input=root?.querySelector('input');
  const done=root?.querySelector('button[aria-label="Done"]');
  if(input?.value!==want||!done||done.disabled)return false;done.click();return true;
 },title);
 if(!committed)throw Error('RECOVERY_REVIEW_REQUIRED: Scene title was not entered/committed in its Rename dialog.');
 for(let n=0;n<30;n++){const after=(await media.snapshot(page)).find(t=>t.assetId===assetId||t.assetIds?.includes(assetId));if(after?.assetTitle===title)return;await wait(150);}
 throw Error('RECOVERY_REVIEW_REQUIRED: Renamed video title could not be read back; no completion claimed.');
}
async function ensure(page,story,targets,inventory,{log=()=>{}}={}){
 const planned=plan(story,targets,inventory),verified=[];
 for(const item of planned){await rename(page,item.assetId,item.sceneId);verified.push({...item,titleVerified:true});log(`Scene ${item.scene}: video title verified as ${item.sceneId}.`);}
 return verified;
}
module.exports={plan,locate,rename,ensure};
