const media=require('./single_clip_omni_media');
const bg=require('./single_clip_omni_background');
const recovery=require('./single_clip_omni_recovery');
function blocked(text){return /polic(?:y|ies)|minors?|underage|unusual activity|not enough credits|out of credits/i.test(String(text||''));}
function clickRetry({key,assetId}){
 const store=window.__singleOmniTileKeys;
 const tile=[...document.querySelectorAll('flow-video-tile')].find(t=>store?.keys.get(t)===key||assetId&&[...t.querySelectorAll('img,video,source')].some(e=>(e.currentSrc||e.getAttribute('src')||'').includes('/'+assetId)));
 if(!tile)return null;
 let scope=tile;
 for(let p=tile.parentElement,n=0;p&&n<12;p=p.parentElement,n++){if(p.querySelectorAll('flow-video-tile').length>1)break;scope=p;}
 const buttons=[...scope.querySelectorAll('button,[role="button"]')].filter(b=>!b.disabled&&b.getBoundingClientRect().width>0);
 const label=b=>(b.getAttribute('aria-label')||b.innerText||b.textContent||'').trim();
 const retry=buttons.find(b=>/^(?:retry|try again)(?: generation)?$/i.test(label(b)));
 const reuse=buttons.find(b=>/^reuse(?: prompt)?$/i.test(label(b)));
 const button=retry||reuse;if(!button)return null;button.click();return retry?'retry':'reuse';
}
async function retry(engine,job,receipt,{log=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const page=engine.page;await page.bringToFront();
 let tile=media.locateJob(await media.snapshot(page),job,receipt);
 if(!tile){await page.evaluate(bg.scrollToPosition,0);for(let i=0;i<100&&!tile;i++){
  await sleep(500);tile=media.locateJob(await media.snapshot(page),job,{assetId:receipt?.assetId,key:''});
  if(tile)break;const m=await page.evaluate(bg.metrics);if(m.top>=m.scroll-m.client-2)break;
  await page.evaluate(bg.scrollToPosition,m.top+Math.floor(m.client*0.75));
 }}
 if(tile?.ready)return {...receipt,key:tile.key,assetId:tile.assetId};
 if(!tile?.failed)throw Error(`Scene ${job.number}: failed source not found; no blind resubmission.`);
 if(blocked(tile.text))throw Error(`Scene ${job.number}: provider policy/account restriction; correct it before retrying.`);
 const before=await media.snapshot(page),action=await page.evaluate(clickRetry,tile);
 if(!action)throw Error(`Scene ${job.number}: no individual Retry or Reuse prompt control; no other clip repeated.`);
 log(`Scene ${job.number}: using its own ${action} control only.`);
 if(action==='reuse'){
  await engine.typePrompt(job.prompt);
  if(!await engine.selectRefsForScene(job.scene,job.number))throw Error('Retry references missing.');
  const next={scene:job.number,excluded:before.flatMap(t=>[t.key,t.assetId].filter(Boolean)),attemptedAt:new Date().toISOString()};
  await engine.clickStartGeneration();
  return recovery.confirmSubmission(page,job,next,{approve:()=>engine.autoApproveCredits(),sleep});
 }
 for(let i=0;i<30;i++){
  await sleep(1000);const tiles=await media.snapshot(page);
  const matches=tiles.filter(t=>media.promptMatches(t,job)&&!t.failed);
  if(matches.length===1)return {...receipt,key:matches[0].key,assetId:matches[0].assetId,confirmedAt:new Date().toISOString()};
  if(matches.length>1)throw Error(`Scene ${job.number}: ambiguous retry result; stopped.`);
 }
 throw Error(`Scene ${job.number}: Retry did not start; stopped without repeating it.`);
}
module.exports={blocked,clickRetry,retry};
