'use strict';
const fs=require('fs'),path=require('path');
const media=require('./single_clip_omni_media'),bg=require('./single_clip_omni_background');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function assess(rows,expected,tolerance=0.35){
 const bad=rows.filter(r=>!Number.isFinite(r.duration)||r.duration<=0||Math.abs(r.duration-expected)>tolerance);
 if(bad.length){
  const details=bad.map(r=>`Scene ${r.scene}: expected ${expected}s, actual ${Number.isFinite(r.duration)?r.duration.toFixed(2)+'s':'unverified'}`);
  const unknown=bad.every(r=>!Number.isFinite(r.duration)||r.duration<=0);
  const code=unknown?'CLIP_DURATION_UNVERIFIED':'CLIP_DURATION_MISMATCH';
  const error=Error(`RECOVERY_REVIEW_REQUIRED: ${code}: ${details.join('; ')}. Batch NOT complete; no later batch, download or automatic regeneration. ${unknown?'Preview metadata did not load; no short clip or regeneration is inferred.':'Check the actual Flow model/duration and replace only verified short clips.'}`);
  error.code=code;error.rows=rows;throw error;
 }
 return rows;
}
function markTile(tile){
 const store=window.__singleOmniTileKeys;
 const match=[...document.querySelectorAll('flow-video-tile')].find(t=>store?.keys.get(t)===tile.key&&[...t.querySelectorAll('video,source,img')].some(e=>(e.currentSrc||e.getAttribute('src')||e.getAttribute('poster')||'').includes('/'+tile.assetId)));
 if(!match)return false;
 document.querySelectorAll('[data-veo-duration-target]').forEach(e=>e.removeAttribute('data-veo-duration-target'));
 match.setAttribute('data-veo-duration-target','active');return true;
}
async function readMarkedDuration(page){
 const element=await page.$('[data-veo-duration-target="active"]');
 if(!element)return null;
 try{
  await page.mouse.move(0,0);
  await element.hover();
  await page.evaluate(()=>{
   const v=document.querySelector('[data-veo-duration-target="active"] video');
   if(v&&v.readyState===0&&v.getAttribute('src')){v.preload='metadata';v.load();}
  });
  await page.waitForFunction(()=>{const v=document.querySelector('[data-veo-duration-target="active"] video');return v&&Number.isFinite(v.duration)&&v.duration>0;},{timeout:8000});
  return await page.evaluate(()=>{const v=document.querySelector('[data-veo-duration-target="active"] video');return v&&Number.isFinite(v.duration)?v.duration:null;});
 }catch{return null;}finally{await element.dispose();}
}
async function readDurations(page,targets,{sleep=wait,snapshot=media.snapshot,read=readMarkedDuration}={}){
 const wanted=new Set(targets.map(t=>t.assetId)),found=new Map();
 // Reuse already loaded metadata from the same project's existing player(s).
 // Source identity must match exactly; never use row position or generic titles.
 for(const existing of await page.browser().pages()){
  if(existing.url().split('?')[0]!==page.url().split('?')[0])continue;
  const cached=await existing.evaluate(assetIds=>[...document.querySelectorAll('flow-video-tile')].flatMap(t=>{
   const sources=[...t.querySelectorAll('video,source,img')].flatMap(e=>[e.currentSrc||'',e.getAttribute('src')||'',e.getAttribute('poster')||'']);
   const id=assetIds.find(id=>sources.some(src=>src.includes('/'+id)));
   const video=t.querySelector('video');return id&&video&&Number.isFinite(video.duration)&&video.duration>0?[{assetId:id,duration:video.duration}]:[];
  }),[...wanted]);
  for(const row of cached)found.set(row.assetId,row.duration);
 }
 await page.evaluate(require('./flow_grid_scroll').installGridScroller);
 for(let pass=0;pass<3&&found.size<wanted.size;pass++){
 await page.evaluate(bg.scrollToPosition,0);await sleep(pass?500:300);
 let stuck=0;
 for(let round=0;round<100&&found.size<wanted.size;round++){
  const mounted=await snapshot(page);
  for(const tile of mounted){
   if(!wanted.has(tile.assetId)||found.has(tile.assetId))continue;
   if(await page.evaluate(markTile,tile)){
    const duration=await read(page);
    // Missing metadata is transient, not a resolved result. Retry this asset
    // on the grid instead of counting null as found and opening its editor.
    if(Number.isFinite(duration)&&duration>0)found.set(tile.assetId,duration);
   }
  }
  if(found.size===wanted.size)break;
  const before=await page.evaluate(bg.metrics);
  if(before.top>=before.scroll-before.client-2)break;
  await page.evaluate(bg.scrollToPosition,before.top+Math.max(120,Math.floor(before.client*0.7)));await sleep(300);
  const after=await page.evaluate(bg.metrics);if(after.top<=before.top+2){if(++stuck>=2)break;}else stuck=0;
 }
 }
 return targets.map(t=>({scene:t.scene,assetId:t.assetId,duration:found.get(t.assetId)??null}));
}
function editorDuration(){
 const label=[...document.querySelectorAll('.duration-timecode-label')].find(e=>/Total duration:/i.test(e.textContent));
 const text=label?.querySelector('.duration-timecode-value')?.textContent?.trim();
 const m=/^(\d+):(\d{2}):(\d{2})$/.exec(text||'');
 // Flow displays minutes:seconds:frames, not hours:minutes:seconds.
 return m?Number(m[1])*60+Number(m[2])+Number(m[3])/30:null;
}
async function confirmShortPreviews(page,rows,story,project,seconds,log){
 for(const row of rows){
  row.durationSource='grid_video_metadata';
  if(Number.isFinite(row.duration)&&Math.abs(row.duration-seconds)<=0.35)continue;
  if(!Number.isFinite(row.duration)||row.duration<=0){
   row.duration=null;row.durationSource='unverified';
   log(`Scene ${row.scene}: grid duration is still unavailable after metadata retries; no clip/editor click and no short-duration inference.`);
   continue;
  }
  row.previewDuration=row.duration;row.duration=null;row.durationSource='unverified';
  const title=require('./agent_scene_ids').sceneId(story,row.scene);
  try{
   await page.goto(project,{waitUntil:'domcontentloaded',timeout:30000});
   await page.waitForSelector('flow-video-tile',{timeout:15000});
   await page.evaluate(require('./flow_grid_scroll').installGridScroller);
   let opened=false;
   for(let n=0;n<40&&!opened;n++){
    opened=await page.evaluate(title=>{
     const matches=[...document.querySelectorAll('flow-video-tile')].filter(t=>t.querySelector('.footer-title')?.textContent?.trim()===title);
     if(matches.length!==1)return false;matches[0].querySelector('.container').click();return true;
    },title);
    if(opened)break;
    const m=await page.evaluate(bg.metrics);if(m.top>=m.scroll-m.client-2)break;
    await page.evaluate(bg.scrollToPosition,m.top+Math.floor(m.client*0.7));await wait(150);
   }
   if(!opened)throw Error('Unique scene title not mounted.');
   await page.waitForFunction(editorDuration,{timeout:15000});
   row.duration=await page.evaluate(editorDuration);row.durationSource='full_asset_editor_timecode';
   log(`Scene ${row.scene}: full asset editor confirms ${row.duration.toFixed(2)}s (grid preview ${row.previewDuration?.toFixed(2)||'unknown'}s).`);
  }catch(error){log(`Scene ${row.scene}: full duration could not be confirmed; preview alone does not authorize replacement. ${error.message}`);}
 }
 return rows;
}
async function verifyDurationBeforeNaming(rows,seconds,rename,{log=()=>{}}={}){
 // Source mappings are validated by the caller. A display title is not media duration.
 assess(rows,seconds);
 try{return {identities:await rename(),namingReviewRequired:false};}
 catch(error){
  if(!/SCENE_NAMING_FAILED|Verified video source is not mounted/.test(error.message))throw error;
  log('Actual duration/source verified. Display title naming is deferred; no clips regenerated. Download/order verification remains required. '+error.message);
  return {identities:[],namingReviewRequired:true,namingError:error.message};
 }
}
async function check(browser,{storyFile,project,from=1,to,seconds,report,log=console.log}){
 const story=JSON.parse(fs.readFileSync(storyFile,'utf8'));
 to=Number(to||story.scenes.length);from=Number(from);seconds=Number(seconds||story.scene_seconds||8);
 if(![4,6,8,10].includes(seconds)||from<1||to<from||to>story.scenes.length)throw Error('RECOVERY_REVIEW_REQUIRED: Invalid duration-audit range/settings.');
 await require('./automation_browser').prepareBackground(browser,log);
 const page=await browser.newPage();
 try{
  await page.goto(project,{waitUntil:'domcontentloaded',timeout:120000});
  const jobs=story.scenes.slice(from-1,to).map((scene,i)=>({number:from+i,scene,sceneId:require('./agent_scene_ids').sceneId(story,from+i),prompt:scene.veo3_prompt||scene.script_line||''}));
  const inspected=await require('./single_clip_omni_recovery').inspectProject({browser,page,projectUrl:project},jobs,{}, {page,log});
  const targets=jobs.map(job=>{
   const hit=inspected.found[job.number];
   if(!hit?.ready||!hit.assetId)throw Error(`RECOVERY_REVIEW_REQUIRED: Scene ${job.number} has no unique ready source for duration verification. Nothing submitted.`);
   return {scene:job.number,assetId:hit.assetId};
  });
  // Validate uniqueness/source ownership first, without changing display names.
  require('./agent_video_names').plan(story,targets,inspected.tiles);
  const rows=await readDurations(page,targets);
  await confirmShortPreviews(page,rows,story,project,seconds,log);
  assess(rows,seconds);
  require('./agent_source_receipts').save(storyFile,project,rows);
  const record={project,storyFile:path.resolve(storyFile),expectedSeconds:seconds,from,to,checkedAt:new Date().toISOString(),rows,sourceVerified:true};
  try{
   const naming=await verifyDurationBeforeNaming(rows,seconds,async()=>{
    const titlePage=(await browser.pages()).find(p=>p!==page&&p.url().split('?')[0]===project.split('?')[0])||page;
    try{return await require('./agent_video_names').ensure(titlePage,story,targets,inspected.tiles,{log});}
    catch(error){
     if(titlePage===page||!/Verified video source is not mounted/.test(error.message))throw error;
     log('Existing tab has different media URLs; verifying titles in the source-inspection tab.');
     return require('./agent_video_names').ensure(page,story,targets,inspected.tiles,{log});
    }
   },{log});
   Object.assign(record,naming,{ok:true});
  }catch(error){record.ok=false;if(report)fs.writeFileSync(report,JSON.stringify(record,null,2));throw error;}
  if(report)fs.writeFileSync(report,JSON.stringify(record,null,2));
  log(`DURATION VERIFIED: scenes ${from}-${to}, expected ${seconds}s; actual ${rows.map(r=>r.duration.toFixed(2)+'s').join(', ')}. Batch may advance.`);
  return record;
 }finally{await page.close().catch(()=>{});}
}
if(require.main===module){
 const val=n=>{const i=process.argv.indexOf(n);return i<0?undefined:process.argv[i+1];};
 (async()=>{const browser=await require('puppeteer').connect({browserURL:`http://127.0.0.1:${val('--cdp')||9222}`,defaultViewport:null});try{await check(browser,{storyFile:val('--story'),project:require('./flow_project').normalizeProjectUrl(val('--project')),from:val('--from')||1,to:val('--to'),seconds:val('--seconds'),report:val('--out')});}finally{await browser.disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=2;});
}
module.exports={verifyDurationBeforeNaming,assess,markTile,readMarkedDuration,readDurations,editorDuration,confirmShortPreviews,check};
