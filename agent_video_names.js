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
function renameMenuTarget(){
 const nodes=[...document.querySelectorAll('.cdk-overlay-container [role="menuitem"],.cdk-overlay-container button')].filter(e=>{
  const r=e.getBoundingClientRect(),s=getComputedStyle(e),text=(e.innerText||e.textContent||'').trim();
  if(!/\bRename\s*$/i.test(text)||e.disabled||e.getAttribute('aria-disabled')==='true'||!r.width||!r.height||s.visibility==='hidden'||s.display==='none'||s.pointerEvents==='none')return false;
  const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit&&(hit===e||e.contains(hit));
 });
 // Angular can expose both a menuitem wrapper and its inner button. They are
 // one action, not two competing Rename entries. Distinct active actions stay ambiguous.
 const leaves=nodes.filter(e=>!nodes.some(child=>child!==e&&e.contains(child)));
 if(leaves.length!==1)return null;
 leaves[0].scrollIntoView({block:'nearest',inline:'nearest'});
 const r=leaves[0].getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
 return hit&&(hit===leaves[0]||leaves[0].contains(hit))?{x,y}:null;
}
function exposeTile({key,assetId}){
 const keys=window.__singleOmniTileKeys?.keys;
 const matches=[...document.querySelectorAll('flow-video-tile')].filter(t=>keys?.get(t)===key||assetId&&[...t.querySelectorAll('video,source,img')].some(e=>(e.currentSrc||e.getAttribute('src')||'').includes('/'+assetId)));
 if(matches.length!==1)return false;
 matches[0].scrollIntoView({block:'nearest',inline:'nearest'});return true;
}
async function rename(page,assetId,title){
 let live,clicked=false;
 for(let attempt=0;attempt<3&&!clicked;attempt++){
  for(let n=0;n<5;n++){if(!await page.evaluate(bg.closeMenus))break;await wait(100);}
  live=await locate(page,assetId);if(live.assetTitle===title)return;
  if(!live.ready||live.failed||live.busy)throw Error('RECOVERY_REVIEW_REQUIRED: Video is not ready for naming.');
  if(!await page.evaluate(exposeTile,live))throw Error('RECOVERY_REVIEW_REQUIRED: Unique verified video could not be exposed for naming.');
  await wait(150);
  const opened=await page.evaluate(bg.openClipMenu,live);if(!opened.ok||opened.direct)continue;
  let last;
  for(let n=0;n<20&&!clicked;n++){
   const point=await page.evaluate(renameMenuTarget);
   if(point&&last&&Math.abs(point.x-last.x)<1&&Math.abs(point.y-last.y)<1){await page.mouse.click(point.x,point.y);clicked=true;}
   last=point;if(!clicked)await wait(100);
  }
 }
 if(!clicked)throw Error('RECOVERY_REVIEW_REQUIRED: No unique active Rename item for this verified video after three scoped attempts.');
 const selector='.rename-tile-overlay input.editable-text-input, .rename-tile-overlay input';
 await page.waitForSelector(selector,{visible:true,timeout:10000});
 const previous=await page.$eval(selector,e=>e.value);
 if(previous!==live.assetTitle)throw Error('RECOVERY_REVIEW_REQUIRED: Rename dialog belongs to a different title; no name changed.');
 await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.type(title,{delay:20});
 await wait(500); // Let Angular commit the typed model before the save interaction.
 await page.evaluate(()=>document.querySelector('.rename-tile-overlay button[aria-label="Done"]')?.scrollIntoView({block:'center',inline:'nearest'}));
 await wait(150);
 const commitPoint=await page.evaluate(want=>{
  const root=document.querySelector('.rename-tile-overlay'),input=root?.querySelector('input');
  const done=root?.querySelector('button[aria-label="Done"]');
  if(input?.value!==want||!done||done.disabled)return null;
  const r=done.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
  return r.width>0&&r.height>0&&hit&&(hit===done||done.contains(hit))?{x,y}:null;
 },title);
 if(!commitPoint)throw Error('RECOVERY_REVIEW_REQUIRED: Scene title was not entered/committed in its Rename dialog.');
 // Real pointer input blurs the editor before saving; DOM click can leave its model stale.
 await page.mouse.click(commitPoint.x,commitPoint.y);
 for(let n=0;n<60;n++){const after=(await media.snapshot(page)).find(t=>t.assetId===assetId||t.assetIds?.includes(assetId));if(after?.assetTitle===title)return;await wait(150);}
 throw Error('RECOVERY_REVIEW_REQUIRED: Renamed video title could not be read back; no completion claimed.');
}
async function ensure(page,story,targets,inventory,{log=()=>{}}={}){
 const planned=plan(story,targets,inventory),verified=[];
 for(const item of planned){
  try{await rename(page,item.assetId,item.sceneId);}catch(error){if(/Verified video source is not mounted/.test(error.message))throw error;throw Error(`RECOVERY_REVIEW_REQUIRED: SCENE_NAMING_FAILED: Scene ${item.scene}: ${error.message}. Existing generations preserved.`);}
  verified.push({...item,titleVerified:true});log(`Scene ${item.scene}: video title verified as ${item.sceneId}.`);
 }
 return verified;
}
module.exports={plan,locate,rename,ensure,renameMenuTarget,exposeTile};
