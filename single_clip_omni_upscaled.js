const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {execFileSync}=require('child_process');
const {playableVideo}=require('./download_media_validation');
const media=require('./single_clip_omni_media');
const {installGridScroller}=require('./flow_grid_scroll');
const bg=require('./single_clip_omni_background');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function chooseUpscaled(items){
 const options=items.filter(i=>/\bupscaled\b/i.test(i.text)&&!i.disabled);
 const exact=options.filter(i=>/\b720p?\b/i.test(i.text));
 if(exact.length===1)return exact[0];
 if(exact.length>1)throw Error('More than one Upscaled 720p option; refusing to guess.');
 if(options.length===1&&!/\b(?:1080p?|2160p?|4k)\b/i.test(options[0].text))return options[0];
 throw Error('Upscaled 720p download option was not found. Original-size downloads are not used.');
}
function menuItems(){
 return [...document.querySelectorAll('.cdk-overlay-container [role="menuitem"],.cdk-overlay-container mat-option,.cdk-overlay-container button')]
 .filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height;})
 .map(e=>{const r=e.getBoundingClientRect();return {text:(e.innerText||e.textContent||'').trim(),x:r.x+r.width/2,y:r.y+r.height/2,
 disabled:e.disabled||e.getAttribute('aria-disabled')==='true'};});
}
function videoInfo(file){
 const validation=playableVideo(file);
 if(!validation.ok)throw Error(validation.why);
 const p=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',file],{encoding:'utf8',timeout:30000,windowsHide:true}));
 const stream=p.streams?.[0];
 if(!stream||Math.min(stream.width,stream.height)!==720)throw Error(`Upscaled file is ${stream?.width||'?'}x${stream?.height||'?'}, not 720p. File kept for review.`);
 return {...validation,width:stream.width,height:stream.height,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
}
function verifiedExisting(entry,job,out,project,allowNative720=false){
 if(!entry||entry.project!==project||entry.scene!==job.number||entry.promptHash!==crypto.createHash('sha256').update(job.prompt).digest('hex')||!(entry.route==='upscaled-720p'||allowNative720&&entry.route==='native-720p'))return false;
 const file=path.join(out,entry.file);
 if(!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==entry.sha256)return false;
 try{videoInfo(file);return true;}catch{return false;}
}
class UpscaledDownloader{
 constructor(engine,{folder,total,storyHash,outDir=null,ledgerPrefix='omni_upscaled',allowNative720=false,log=()=>{},checkGeneration=async()=>{}}){
  this.allowNative720=allowNative720;
  this.engine=engine;this.folder=folder;this.total=total;this.log=log;this.checkGeneration=checkGeneration;
  this.project=engine.projectUrl;this.out=outDir||path.join(folder,'clips');
  this.ledgerFile=path.join(folder,`${ledgerPrefix}_${this.project.split('/project/')[1]}.json`);
  this.ledger=fs.existsSync(this.ledgerFile)?JSON.parse(fs.readFileSync(this.ledgerFile,'utf8')):{project:this.project,storyHash,clips:[]};
  if(this.ledger.storyHash!==storyHash)throw Error('This Omni download project belongs to a different story version. Use a new project.');
  this.page=null;this.cdp=null;this.activeDownload=null;
 }
 async open(){
  if(this.page)return;
  this.page=await this.engine.browser.newPage(); // Background worker never scrolls or reloads the generation tab.
  await this.page.goto(this.project,{waitUntil:'domcontentloaded',timeout:120000});
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
  const clips=this.ledger.clips.slice().sort((a,b)=>a.scene-b.scene).map(e=>({file:e.file,order:e.scene,matched_scene:e.scene,match_from:'exact Omni source prompt',order_verified:true,
   assetId:e.assetId||null,got:true,width:e.width,height:e.height,route:e.route,sha256:e.sha256}));
  const complete=clips.length===this.total&&clips.every((c,i)=>c.matched_scene===i+1
   &&fs.existsSync(path.join(this.out,c.file))&&crypto.createHash('sha256').update(fs.readFileSync(path.join(this.out,c.file))).digest('hex')===c.sha256);
  const manifest={projectUrl:this.project,expected:this.total,complete,downloadComplete:complete,needsSceneOrdering:false,
   route:'Omni Upscaled 720p',orderResolvedBy:'exact Omni source prompt',clips};
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
   const hit=media.locateJob(tiles,job,receipt?.assetId?{assetId:receipt.assetId,key:''}:null);
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
  const old=this.ledger.clips.find(c=>c.scene===job.number);
  if(verifiedExisting(old,job,this.out,this.project,this.allowNative720)&&(!receipt?.assetId||old.assetId===receipt.assetId)){this.log(`Scene ${job.number}: verified 720p already saved; skipped.`);return old;}
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
  let upscaled,route='upscaled-720p';
  for(let i=0;i<20&&!upscaled;i++){
   const items=await this.page.evaluate(menuItems);
   if(items.some(i=>/upscaled/i.test(i.text))){
    try{upscaled=chooseUpscaled(items);}catch(error){
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
  while(Date.now()<deadline){
   const d=this.activeDownload;
   if(d.error)throw Error(d.error);
   if(d.status==='canceled')throw Error(`Scene ${job.number}: upscaled download was canceled.`);
   if(d.status==='completed'&&d.guid&&fs.existsSync(path.join(this.temp,d.guid)))break;
   await this.checkGeneration();await sleep(1000);
  }
  const d=this.activeDownload;
  if(d.status!=='completed'||!d.guid)throw Error(`Scene ${job.number}: upscaled download did not finish within 6 minutes.`);
  const source=path.join(this.temp,d.guid),info=videoInfo(source);
  const file=`scene-${String(job.number).padStart(2,'0')}.mp4`,dest=path.join(this.out,file);
  fs.mkdirSync(this.out,{recursive:true});
  if(fs.existsSync(dest)){
   const replaced=path.join(this.out,'_replaced');fs.mkdirSync(replaced,{recursive:true});
   fs.renameSync(dest,path.join(replaced,`${Date.now()}_${file}`));
  }
  fs.copyFileSync(source,dest);
  const entry={scene:job.number,file,project:this.project,promptHash:crypto.createHash('sha256').update(job.prompt).digest('hex'),
   assetId:hit.assetId,route,width:info.width,height:info.height,sha256:info.sha256};
  this.ledger.clips=this.ledger.clips.filter(c=>c.scene!==job.number);this.ledger.clips.push(entry);this.save();this.activeDownload=null;
  this.log(`Scene ${job.number}: saved and decoded ${info.width}x${info.height} Upscaled clip.`);return entry;
 }
 async group(jobs,receipts){try{for(const job of jobs){await this.checkGeneration();await this.download(job,receipts[job.number]);}}finally{await this.engine.page.bringToFront();}}
 async close(){if(this.cdp){await this.cdp.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:false}).catch(()=>{});await this.cdp.detach().catch(()=>{});}if(this.page)await this.page.close();}
}
module.exports={UpscaledDownloader,chooseUpscaled,videoInfo,verifiedExisting,menuItems};
