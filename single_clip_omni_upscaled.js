const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {execFileSync}=require('child_process');
const {playableVideo}=require('./download_media_validation');
const media=require('./single_clip_omni_media');
const {installGridScroller}=require('./flow_grid_scroll');
const bg=require('./single_clip_omni_background');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function chooseUpscaled(items,target=720){
 if(![720,1080].includes(target))throw Error('Unsupported upscale target.');
 const options=items.filter(i=>/\bupscaled\b/i.test(i.text)&&!i.disabled);
 const exact=options.filter(i=>new RegExp(`\\b${target}p?\\b`,'i').test(i.text));
 if(exact.length===1)return exact[0];
 if(exact.length>1)throw Error(`More than one Upscaled ${target}p option; refusing to guess.`);
 // Some Flow menus label 1080p without repeating the Upscaled caption.
 const labelled=items.filter(i=>!i.disabled&&new RegExp(`^${target}p(?:\\s|$)`,'i').test(i.text)&&!/original/i.test(i.text));
 if(labelled.length===1)return labelled[0];
 if(options.length===1&&!/\b(?:360p?|720p?|1080p?|2160p?|4k)\b/i.test(options[0].text))return options[0];
 throw Error(`Upscaled ${target}p download option was not found. Original-size downloads are not used.`);
}
function chooseOriginal(items,target){
 const candidates=items.filter(i=>!i.disabled&&!/upscaled|upscale|4k|2160p/i.test(i.text));
 const labelled=candidates.filter(i=>/original/i.test(i.text));
 if(labelled.length===1)return labelled[0];
 const exact=candidates.filter(i=>new RegExp(`\\b${target}p\\b`,'i').test(i.text));
 if(exact.length===1)return exact[0];
 throw Error('Original download option was not found; no other version substituted.');
}
function menuItems(){
 return [...document.querySelectorAll('.cdk-overlay-container [role="menuitem"],.cdk-overlay-container mat-option,.cdk-overlay-container button')]
 .filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height;})
 .map(e=>{const r=e.getBoundingClientRect();return {text:(e.innerText||e.textContent||'').trim(),x:r.x+r.width/2,y:r.y+r.height/2,
 disabled:e.disabled||e.getAttribute('aria-disabled')==='true'};});
}
function videoInfo(file,target=720){
 const validation=playableVideo(file);
 if(!validation.ok)throw Error(validation.why);
 const p=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',file],{encoding:'utf8',timeout:30000,windowsHide:true}));
 const stream=p.streams?.[0];
 if(!stream||Math.min(stream.width,stream.height)!==target)throw Error(`Upscaled file is ${stream?.width||'?'}x${stream?.height||'?'}, not ${target}p. File kept for review.`);
 return {...validation,width:stream.width,height:stream.height,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
}
function verifiedExisting(entry,job,out,project,allowNative720=false,target=720,version='upscaled'){
 const routeOk=version==='original'?entry?.route===`original-${target}p`:(entry?.route===`upscaled-${target}p`||target===720&&allowNative720&&entry?.route==='native-720p');
 if(!entry||entry.project!==project||entry.scene!==job.number||entry.promptHash!==crypto.createHash('sha256').update(job.prompt).digest('hex')||!routeOk)return false;
 const file=path.join(out,entry.file);
 if(!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==entry.sha256)return false;
 try{videoInfo(file,target);return true;}catch{return false;}
}
class UpscaledDownloader{
 constructor(engine,{folder,total,storyHash,outDir=null,ledgerPrefix='omni_upscaled',allowNative720=false,upscaleFromSource=false,targetResolution=720,downloadVersion='upscaled',orderMode='scene',useExistingPage=false,log=()=>{},checkGeneration=async()=>{}}){
  if(!['original','upscaled'].includes(downloadVersion))throw Error('Choose Original or Upscaled downloads.');
  this.downloadVersion=downloadVersion;
  if(!['scene','unresolved-assets'].includes(orderMode))throw Error('Unsupported download ordering mode.');
  this.orderMode=orderMode;
  this.useExistingPage=useExistingPage;
  this.allowNative720=allowNative720;
  this.upscaleFromSource=upscaleFromSource;
  this.targetResolution=targetResolution;this.targets=new Map();
  this.engine=engine;this.folder=folder;this.total=total;this.log=log;this.checkGeneration=checkGeneration;
  this.project=engine.projectUrl;this.out=outDir||path.join(folder,'clips');
  this.ledgerFile=path.join(folder,`${ledgerPrefix}_${this.project.split('/project/')[1]}.json`);
  this.ledger=fs.existsSync(this.ledgerFile)?JSON.parse(fs.readFileSync(this.ledgerFile,'utf8')):{project:this.project,storyHash,clips:[]};
  if(this.ledger.storyHash!==storyHash)throw Error('This Omni download project belongs to a different story version. Use a new project.');
  this.page=null;this.cdp=null;this.activeDownload=null;
  this.sourcePrompts=new Map();
 }
 async open(){
  if(this.page)return;
  this.page=this.useExistingPage?this.engine.page:await this.engine.browser.newPage();
  if(!this.useExistingPage)await this.page.goto(this.project,{waitUntil:'domcontentloaded',timeout:120000});
  await this.page.bringToFront();
  await this.page.waitForSelector('flow-video-tile',{timeout:120000});
  await this.page.evaluate(installGridScroller);
  this.temp=path.join(this.folder,'logs',`omni_upscaled_download_${Date.now()}`);fs.mkdirSync(this.temp,{recursive:true});
  this.cdp=await this.engine.browser.target().createCDPSession();
  await this.cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:this.temp,eventsEnabled:true});
  this.cdp.on('Browser.downloadWillBegin',e=>{if(this.activeDownload){
   if(this.activeDownload.guid&&this.activeDownload.guid!==e.guid)this.activeDownload.error='Multiple browser downloads started; refusing to choose a file.';
   else this.activeDownload.guid=e.guid;
  }});
  this.cdp.on('Browser.downloadProgress',e=>{if(this.activeDownload?.guid===e.guid)this.activeDownload.status=e.state;});
 }
 save(){
  fs.mkdirSync(this.out,{recursive:true});
  fs.writeFileSync(this.ledgerFile+'.tmp',JSON.stringify(this.ledger,null,2));fs.renameSync(this.ledgerFile+'.tmp',this.ledgerFile);
  const unresolved=this.orderMode==='unresolved-assets';
  const clips=this.ledger.clips.slice().sort((a,b)=>a.scene-b.scene).map(e=>({file:e.file,order:e.scene,matched_scene:unresolved?null:e.scene,match_from:unresolved?'asset identity; narration ordering pending':'exact Omni source prompt',order_verified:!unresolved,
   assetId:e.assetId||null,got:true,width:e.width,height:e.height,route:e.route,sha256:e.sha256}));
  const complete=clips.length===this.total&&clips.every((c,i)=>c.order===i+1
   &&Math.min(c.width,c.height)===(this.targets.get(c.order)||this.targetResolution)
   &&fs.existsSync(path.join(this.out,c.file))&&crypto.createHash('sha256').update(fs.readFileSync(path.join(this.out,c.file))).digest('hex')===c.sha256);
  const manifest={projectUrl:this.project,expected:this.total,complete:complete&&!unresolved,downloadComplete:complete,needsSceneOrdering:unresolved,
   route:this.upscaleFromSource?'Source-matched Upscaled':`Omni ${this.downloadVersion==='original'?'Original':'Upscaled'} ${this.targetResolution}p`,orderResolvedBy:unresolved?null:'exact Omni source prompt',clips};
  fs.writeFileSync(path.join(this.out,'omni_manifest.partial.json'),JSON.stringify(manifest,null,2));
  if(complete){
   const target=path.join(this.out,'manifest.json');
   if(fs.existsSync(target))fs.copyFileSync(target,target+`.before-omni-upscaled-${Date.now()}`);
   fs.writeFileSync(target+'.tmp',JSON.stringify(manifest,null,2));fs.renameSync(target+'.tmp',target);
  }
 }
 async find(job,receipt){
  await this.page.evaluate(bg.closeMenus);
  await this.page.evaluate(installGridScroller);
  const initial=await this.page.evaluate(bg.metrics);
  const mounted=media.locateJob(await media.snapshot(this.page),job,receipt?.assetId?{assetId:receipt.assetId,key:''}:null);
  if(!mounted&&initial.top>10)await this.page.evaluate(bg.scrollToPosition,0);
  // One bounded walk to this requested asset. No full-project polling loops.
  for(let i=0;i<100;i++){
   const tiles=await media.snapshot(this.page);
   let hit=media.locateJob(tiles,job,receipt?.assetId?{assetId:receipt.assetId,key:''}:null);
   if(!hit&&this.orderMode!=='unresolved-assets'){
    // Thumbnail URLs can change between visits, and collapsed cards show only
    // generated captions. Read the original source in the download tab.
    for(const tile of tiles){
     // CDK recycles DOM nodes: one node key can later represent another clip.
     // Cache by the current media identity, never by the DOM node key alone.
     const cacheKey=tile.assetId?`${tile.assetId}:${media.norm(tile.text)}`:null;
     let source=cacheKey?this.sourcePrompts.get(cacheKey):undefined;
     if(source===undefined){source=await require('./single_clip_omni_recovery').readSourcePrompt(this.page,tile);if(cacheKey&&source)this.sourcePrompts.set(cacheKey,source);}
     if(source)tile.text+='\n'+source;
    }
    hit=media.locateJob(tiles,job,null);
   }
   if(hit){
    if(hit.failed||!hit.ready)throw Error(`Scene ${job.number} is not ready for download.`);
    return hit;
   }
   const metrics=await this.page.evaluate(bg.metrics);
   if(metrics.top>=metrics.scroll-metrics.client-2)break;
   await this.page.evaluate(bg.scrollToPosition,metrics.top+Math.floor(metrics.client*0.75));await sleep(1000);
   const after=await this.page.evaluate(bg.metrics);
   if(after.top<=metrics.top+2)throw Error('Background download scroll did not advance. No other clip selected.');
   await this.checkGeneration();
  }
  throw Error(`Scene ${job.number}: completed tile not found; nothing substituted.`);
 }
 async download(job,receipt){
  let target=this.downloadVersion==='original'?(receipt?.nativeResolution||this.targetResolution):(this.upscaleFromSource&&receipt?.native720?1080:this.targetResolution);
  this.targets.set(job.number,target);
  const old=this.ledger.clips.find(c=>c.scene===job.number);
  if(this.downloadVersion==='original'&&/^original-(360|720|1080)p$/.test(old?.route||'')){
   target=Number(old.route.match(/\d+/)[0]);this.targets.set(job.number,target);
  }
  const stableId=id=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id||'');
  const differentStableSource=(stableId(old?.assetId)&&stableId(receipt?.assetId)&&old.assetId!==receipt.assetId)
   ||(old?.sourceAttemptedAt&&receipt?.attemptedAt&&old.sourceAttemptedAt!==receipt.attemptedAt);
  if(verifiedExisting(old,job,this.out,this.project,this.allowNative720,target,this.downloadVersion)&&!differentStableSource){this.log(`Scene ${job.number}: verified ${target}p already saved; skipped.`);return old;}
  await this.open();
  const hit=await this.find(job,receipt);
  const opened=await this.page.evaluate(bg.openClipMenu,hit);
  if(!opened?.ok)throw Error(`Scene ${job.number}: ${opened?.why||'clip menu could not be opened'}.`);
  let download;
  for(let i=0;i<20&&!download;i++){
   const items=await this.page.evaluate(menuItems);
   download=items.find(i=>/(?:^|\s)Download\s*$/i.test(i.text)&&!i.disabled);if(!download)await sleep(250);
  }
  if(!opened.direct){
   if(!download)throw Error(`Scene ${job.number}: Download menu item was not found.`);
   if(!await this.page.evaluate(bg.clickMenuText,download.text))throw Error('Download menu click did not target one visible item.');
  }
  let upscaled,route=`${this.downloadVersion}-${target}p`;
  for(let i=0;i<20&&!upscaled;i++){
   const items=await this.page.evaluate(menuItems);
   if(items.some(i=>/original|upscaled|1080p|720p|360p/i.test(i.text))){
    try{
     upscaled=this.downloadVersion==='original'?chooseOriginal(items,target):chooseUpscaled(items,target);
     if(this.downloadVersion==='original'){
      const labelledResolution=upscaled.text.match(/\b(360|720|1080)p\b/i);
      if(labelledResolution){target=Number(labelledResolution[1]);this.targets.set(job.number,target);route=`original-${target}p`;}
     }
    }catch(error){
     const native=this.allowNative720&&receipt?.native720&&items.filter(i=>/original/i.test(i.text)&&!i.disabled&&!/360p|1080p|2160p|4k/i.test(i.text));
     if(native&&native.length===1){upscaled=native[0];route='native-720p';this.log(`Scene ${job.number}: source is already 720p; keeping its native resolution.`);}else throw error;
    }
   }else await sleep(250);
  }
  if(!upscaled)throw Error(`Scene ${job.number}: Upscaled submenu did not open.`);
  this.activeDownload={};
  this.log(`Scene ${job.number}: Download > ${upscaled.text.replace(/\s+/g,' ')}.`);
  if(!await this.page.evaluate(bg.clickMenuText,upscaled.text))throw Error('Upscaled menu click did not target one visible item.');
  const deadline=Date.now()+6*60*1000;
  const startDeadline=Date.now()+90000;
  while(Date.now()<deadline){
   const d=this.activeDownload;
   if(!d.guid&&Date.now()>=startDeadline){const error=Error(`Scene ${job.number}: Flow did not start the upscaled download within 90 seconds.`);error.code='DOWNLOAD_NOT_STARTED';throw error;}
   if(d.error)throw Error(d.error);
   if(d.status==='canceled')throw Error(`Scene ${job.number}: upscaled download was canceled.`);
   if(d.status==='completed'&&d.guid&&fs.existsSync(path.join(this.temp,d.guid)))break;
   await this.checkGeneration();await sleep(1000);
  }
  const d=this.activeDownload;
  if(d.status!=='completed'||!d.guid){const error=Error(`Scene ${job.number}: upscaled download did not finish within 6 minutes.`);error.code='DOWNLOAD_TIMEOUT';throw error;}
  const source=path.join(this.temp,d.guid),info=videoInfo(source,target);
  const file=this.orderMode==='unresolved-assets'?`asset-${crypto.createHash('sha256').update(String(receipt?.assetId||hit.assetId)).digest('hex').slice(0,16)}.mp4`:`scene-${String(job.number).padStart(2,'0')}.mp4`,dest=path.join(this.out,file);
  fs.mkdirSync(this.out,{recursive:true});
  if(fs.existsSync(dest)){
   const replaced=path.join(this.out,'_replaced');fs.mkdirSync(replaced,{recursive:true});
   fs.renameSync(dest,path.join(replaced,`${Date.now()}_${file}`));
  }
  fs.copyFileSync(source,dest);
  const entry={scene:job.number,file,project:this.project,promptHash:crypto.createHash('sha256').update(job.prompt).digest('hex'),
   assetId:hit.assetId,sourceAttemptedAt:receipt?.attemptedAt||null,route,width:info.width,height:info.height,sha256:info.sha256};
  this.ledger.clips=this.ledger.clips.filter(c=>c.scene!==job.number);this.ledger.clips.push(entry);this.save();this.activeDownload=null;
  this.log(`Scene ${job.number}: saved and decoded ${info.width}x${info.height} ${this.downloadVersion} clip.`);return entry;
 }
 async group(jobs,receipts){
  for(const job of jobs)this.targets.set(job.number,this.downloadVersion==='original'?(receipts[job.number]?.nativeResolution||this.targetResolution):(this.upscaleFromSource&&receipts[job.number]?.native720?1080:this.targetResolution));
  try{for(const job of jobs){
   await this.checkGeneration();
   for(let attempt=0;attempt<2;attempt++){
    try{await this.download(job,receipts[job.number]);break;}
    catch(error){
     if(attempt||!['DOWNLOAD_NOT_STARTED','DOWNLOAD_TIMEOUT'].includes(error.code))throw error;
     this.log(`Scene ${job.number}: retrying this download once; completed clips are preserved and no generation prompt is submitted.`);
     this.activeDownload=null;
     await this.page.keyboard.press('Escape');await sleep(1000);
    }
   }
  }}finally{await this.engine.page.bringToFront();}
 }
 async close(){if(this.cdp){await this.cdp.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:false}).catch(()=>{});await this.cdp.detach().catch(()=>{});}if(this.page&&!this.useExistingPage)await this.page.close();}
}
module.exports={UpscaledDownloader,chooseUpscaled,chooseOriginal,videoInfo,verifiedExisting,menuItems};
