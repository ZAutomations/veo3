const media=require('./single_clip_omni_media');
const {installGridScroller}=require('./flow_grid_scroll');
const bg=require('./single_clip_omni_background');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function reuseForInspection({key,assetId}){
 const store=window.__singleOmniTileKeys;
 const tile=[...document.querySelectorAll('flow-video-tile')].find(t=>store?.keys.get(t)===key||assetId&&[...t.querySelectorAll('img,video,source')].some(e=>(e.currentSrc||e.getAttribute('src')||'').includes('/'+assetId)));
 if(!tile)return null;
 let scope=tile;
 for(let p=tile.parentElement,n=0;p&&n<12;p=p.parentElement,n++){if(p.querySelectorAll('flow-video-tile').length>1)break;scope=p;}
 const button=[...scope.querySelectorAll('button')].find(b=>!b.disabled&&/^reuse(?: prompt)?$/i.test((b.getAttribute('aria-label')||b.innerText||b.textContent||'').trim()));
 if(!button)return null;
 const previous=document.querySelector('.ProseMirror')?.innerText||'';
 button.click();return {previous};
}
async function inspectProjectOnce(engine,jobs,receipts={},options={}){
 const log=options.log||(()=>{}),wait=options.sleep||sleep;
 const ownsPage=!options.page;
 const page=options.page||await engine.browser.newPage();let retained=false;
 const sourceCache=options.sourceCache||new Map();
 try{
  if(ownsPage)await page.goto(engine.projectUrl,{waitUntil:'domcontentloaded',timeout:120000});
  await page.bringToFront();
  await page.waitForSelector('flow-video-tile',{timeout:30000});
  await page.evaluate(installGridScroller);
  const start=await page.evaluate(bg.metrics);if(start.top>10)await page.evaluate(bg.scrollToPosition,0);
  const records=new Map();let exhaustive=false,quiet=0,targetsVerified=false;
  const findSources=()=>Object.fromEntries(jobs.map(job=>{
   const receipt=receipts[job.number];
   return [job.number,media.locateJob([...records.values()],job,receipt?{assetId:receipt.assetId,key:'',excluded:(receipt.excluded||[]).filter(v=>!String(v).startsWith('omni-'))}:null)];
  }));
  for(let round=0;round<100;round++){
   for(const tile of await media.snapshot(page)){
    const id=tile.assetId||tile.key,old=records.get(id)||sourceCache.get(id);
    if(old?.sourcePrompt)tile.text+='\n'+old.sourcePrompt;
    else if(!jobs.some(job=>media.promptMatches(tile,job))){
     // Completed cards may expose only a generated caption. Reuse copies the
     // original prompt into THIS inspection tab; never press Generate here.
     const copied=await page.evaluate(reuseForInspection,tile);
     if(copied){
      await page.waitForFunction(previous=>{const text=document.querySelector('.ProseMirror')?.innerText||'';return text.trim()&&text!==previous;},{timeout:10000},copied.previous);
      tile.sourcePrompt=await page.evaluate(()=>document.querySelector('.ProseMirror')?.innerText||'');
      tile.text+='\n'+tile.sourcePrompt;
     }
    }
    if(old?.sourcePrompt)tile.sourcePrompt=old.sourcePrompt;
    records.set(id,tile);
    if(tile.assetId&&tile.sourcePrompt)sourceCache.set(id,{sourcePrompt:tile.sourcePrompt});
   }
   // Finding every requested source proves its existence without requiring a
   // full-project scan. This never authorizes clearing a missing checkpoint.
   if(jobs.length&&Object.values(findSources()).every(Boolean)){targetsVerified=true;break;}
   const frame=await page.evaluate(bg.metrics);
   if(round%5===0)log(`Resume inspection: ${records.size} rows, position ${Math.round(frame.top)}/${Math.max(0,frame.scroll-frame.client)}.`);
   if(frame.top>=frame.scroll-frame.client-2){
    await wait(1000);
    const before=records.size;
    for(const tile of await media.snapshot(page)){
     const id=tile.assetId||tile.key,old=records.get(id);
     // A status refresh must not erase source evidence obtained via Reuse.
     if(old?.sourcePrompt){tile.sourcePrompt=old.sourcePrompt;tile.text+='\n'+old.sourcePrompt;}
     records.set(id,tile);
    }
    const next=await page.evaluate(bg.metrics);
    if(next.top>=next.scroll-next.client-2&&next.visible&&records.size===before){if(++quiet>=2){exhaustive=true;break;}}
    else quiet=0;
   }else{
    quiet=0;await page.evaluate(bg.scrollToPosition,frame.top+Math.floor(frame.client*0.75));await wait(1000);
    const after=await page.evaluate(bg.metrics);
    if(after.top<=frame.top+2)throw Error('Background project scroll did not advance. No checkpoint cleared.');
   }
  }
  const tiles=[...records.values()],found={};
  for(const job of jobs){
   const receipt=receipts[job.number];
   // DOM node keys belong to the generation tab. Only stable asset IDs and
   // exact source prompts can match rows in this background tab.
   found[job.number]=media.locateJob(tiles,job,receipt?{assetId:receipt.assetId,key:'',excluded:(receipt.excluded||[]).filter(v=>!String(v).startsWith('omni-'))}:null);
  }
  log(`Resume source check: ${tiles.length} video rows inspected; full project=${exhaustive}; active generations=${tiles.filter(t=>t.busy).length}.`);
  const result={found,exhaustive,targetsVerified,unidentifiedSources:tiles.some(t=>!t.sourcePrompt&&!jobs.some(j=>media.promptMatches(t,j))),generatingSeen:tiles.some(t=>t.busy),tiles};
  if(options.keepOpen){retained=true;result.page=page;}
  return result;
 }finally{if(ownsPage&&!retained){
  // A closed generation tab must not mask inspection results or prevent the
  // temporary inspection tab from being cleaned up.
  try{if(!engine.page.isClosed?.())await engine.page.bringToFront();}catch{}
  try{if(!page.isClosed?.())await page.close();}catch{}
 }}
}
async function inspectProject(engine,jobs,receipts={},options={}){
 for(let attempt=0;attempt<3;attempt++){
  try{return await inspectProjectOnce(engine,jobs,receipts,options);}
  catch(error){
   if(options.page||attempt===2||!/Execution context was destroyed|Cannot find context with specified id|frame was detached/i.test(error.message))throw error;
   (options.log||(()=>{}))('Flow navigated during read-only inspection; opening a fresh inspection tab. No generation submitted.');
  }
 }
}
function reconcilePending(state,pending,result){
 if(!result.exhaustive&&!(pending.length&&pending.every(n=>result.found[n])))throw Error('Resume project check was incomplete. No scene resubmitted.');
 const completed=[],missing=[],waiting=[];
 for(const number of pending){
  const tile=result.found[number];
  if(tile?.failed)throw Error(`Scene ${number} has a failed tile; it is not resubmitted automatically.`);
  if(tile?.ready)completed.push(number);
  else if(tile)waiting.push(number);
  else if(!result.generatingSeen&&!result.unidentifiedSources)missing.push(number);
  else throw Error(`Scene ${number} has no matching source while another generation is active; stopped without guessing.`);
 }
 return {completed,missing,waiting};
}
async function confirmSubmission(page,job,receipt,{timeout=60000,sleep:wait=sleep,approve=async()=>false}={}){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  await approve();
  const tile=media.locateJob(await media.snapshot(page),job,receipt);
  if(tile){
   if(tile.failed)throw Error(`Scene ${job.number}: Flow created a failed generation tile.`);
   return {...receipt,key:tile.key,assetId:tile.assetId,confirmedAt:new Date().toISOString()};
  }
  const rejection=await page.evaluate(()=>{
   const alerts=[...document.querySelectorAll('[role="alert"],.mat-mdc-snack-bar-label,.mdc-snackbar__label')];
   return alerts.map(e=>(e.innerText||e.textContent||'').trim()).find(t=>/unusual activity|cannot generate|can.t generate|unable to generate|generation failed|not enough credits|out of credits|quota|not supported/i.test(t))||'';
  });
  if(rejection){const error=Error(`Scene ${job.number}: Flow rejected the submission: ${rejection}`);error.code='FLOW_REJECTED';throw error;}
  await wait(1000);
 }
 throw Error(`Scene ${job.number}: no new matching clip tile appeared after Generate. Submission is unconfirmed; no later prompt submitted.`);
}
async function readSourcePrompt(page,tile){
 const copied=await page.evaluate(reuseForInspection,tile);
 if(!copied)return '';
 await page.waitForFunction(previous=>{const text=document.querySelector('.ProseMirror')?.innerText||'';return text.trim()&&text!==previous;},{timeout:10000},copied.previous);
 return page.evaluate(()=>document.querySelector('.ProseMirror')?.innerText||'');
}
module.exports={inspectProject,reconcilePending,confirmSubmission,readSourcePrompt};
