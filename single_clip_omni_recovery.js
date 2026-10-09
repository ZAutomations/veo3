const media=require('./single_clip_omni_media');
const {installGridScroller}=require('./flow_grid_scroll');
const bg=require('./single_clip_omni_background');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function inspectProject(engine,jobs,receipts={},options={}){
 const log=options.log||(()=>{}),wait=options.sleep||sleep;
 const page=await engine.browser.newPage();let retained=false;
 try{
  await page.goto(engine.projectUrl,{waitUntil:'domcontentloaded',timeout:120000});
  await page.bringToFront();
  await page.waitForSelector('flow-video-tile',{timeout:30000});
  await page.evaluate(installGridScroller);
  const start=await page.evaluate(bg.metrics);if(start.top>10)await page.evaluate(bg.scrollToPosition,0);
  const records=new Map();let exhaustive=false,quiet=0;
  for(let round=0;round<100;round++){
   for(const tile of await media.snapshot(page))records.set(tile.assetId||tile.key,tile);
   const frame=await page.evaluate(bg.metrics);
   if(round%5===0)log(`Resume inspection: ${records.size} rows, position ${Math.round(frame.top)}/${Math.max(0,frame.scroll-frame.client)}.`);
   if(frame.top>=frame.scroll-frame.client-2){
    await wait(1000);
    const before=records.size;
    for(const tile of await media.snapshot(page))records.set(tile.assetId||tile.key,tile);
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
  const result={found,exhaustive,generatingSeen:tiles.some(t=>t.busy),tiles};
  if(options.keepOpen){retained=true;result.page=page;}
  return result;
 }finally{if(!retained){await engine.page.bringToFront();await page.close();}}
}
function reconcilePending(state,pending,result){
 if(!result.exhaustive)throw Error('Resume project check was incomplete. No scene resubmitted.');
 const completed=[],missing=[],waiting=[];
 for(const number of pending){
  const tile=result.found[number];
  if(tile?.failed)throw Error(`Scene ${number} has a failed tile; it is not resubmitted automatically.`);
  if(tile?.ready)completed.push(number);
  else if(tile)waiting.push(number);
  else if(!result.generatingSeen)missing.push(number);
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
module.exports={inspectProject,reconcilePending,confirmSubmission};
