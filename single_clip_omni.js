const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawn}=require('child_process');
const {Veo3FlowNewUI}=require('./veo3_flow_new_ui');
const {loadStoryRefs}=require('./refs_for_scene');
const {normalizeProjectUrl}=require('./flow_project');
const saved=require('./saved_couple');
const settings=require('./single_clip_omni_settings');
const media=require('./single_clip_omni_media');
const recovery=require('./single_clip_omni_recovery');
const bg=require('./single_clip_omni_background');
const backlog=require('./single_clip_omni_backlog');
const failedRetry=require('./single_clip_omni_retry');
const {UpscaledDownloader}=require('./single_clip_omni_upscaled');
const {runQueue}=require('./single_clip_omni_queue');
const {installGridScroller,gridMetrics,wheelGrid}=require('./flow_grid_scroll');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const log=s=>console.log(`[${new Date().toLocaleTimeString()}] ${s}`);
function promptsFor(story,folder,useSimple=true){
 return story.scenes.map((scene,i)=>{
  const simple=path.join(folder,'simple_test_clip_prompts',`clip_${String(i+1).padStart(3,'0')}.txt`);
  const prompt=useSimple&&fs.existsSync(simple)?fs.readFileSync(simple,'utf8'):String(scene.veo3_prompt||'');
  if(!prompt.trim())throw Error(`Scene ${i+1} has no prompt.`);
  return {number:i+1,scene,prompt:prompt.trim()};
 });
}
function child(file,args){return new Promise((resolve,reject)=>{
 const p=spawn(process.execPath,[path.join(__dirname,file),...args],{cwd:__dirname,stdio:'inherit'});
 p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(`${file} stopped with exit ${code}.`)));
});}
async function run(request){
 const file=path.resolve(request.story),folder=path.dirname(file);
 const story=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 const from=Number(request.from||1),to=Number(request.to||story.scenes.length);
 if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>story.scenes.length)throw Error('Invalid scene range.');
 if(!/Omni.*Flash/i.test(request.model||''))throw Error('Select Omni Flash in the Single Clip Omni tab.');
 if(!['360p','720p'].includes(request.resolution))throw Error('Select 360p or 720p.');
 const allJobs=promptsFor(story,folder,request.simple!==false);
 const jobs=allJobs.slice(from-1,to);
 const engine=new Veo3FlowNewUI(file,{fromScene:1,toScene:to,cdp:`http://127.0.0.1:${request.cdp||9222}`,
  referenceCategory:'Images',projectUrl:request.project||'',newProject:!!request.newProject,genRefs:!!request.genRefs,account:request.account||''});
 engine.story=story;engine.scenes=story.scenes;engine.characterReferences=story.character_references||{};
 engine.storyRefs=loadStoryRefs(file,story).refs;
 const gui=fs.existsSync(path.join(__dirname,'gui_settings.json'))?JSON.parse(fs.readFileSync(path.join(__dirname,'gui_settings.json'),'utf8')):{};
 engine.savedCouple=saved.loadSavedCouple('ingredients',{...gui,ing_saved_couple:!!request.savedCouple});
 engine.storyRefs=saved.applySavedRefs(engine.storyRefs,engine.savedCouple);engine.skipRefs=false;
 if(engine.savedCouple&&!request.reuseRefs)engine.genRefs=true;
 if(request.reuseRefs||request.downloadOnly)engine.genRefs=false;
 if(!request.downloadOnly&&!engine.storyRefs.length)throw Error('No character/location references found. Prepare refs.json first.');
 const existingProject=request.project?normalizeProjectUrl(request.project):'';
 const existingState=existingProject?path.join(folder,`single_clip_omni_${existingProject.split('/project/')[1]}_${from}_${to}.json`):'';
 if(!request.newProject&&existingState&&fs.existsSync(existingState))engine.genRefs=false;
 let downloader=null,activeJobs=[];
 await engine.connect();
 try{
  if(!request.downloadOnly&&(request.newProject||engine.genRefs))await settings.prepareReferences(engine,{log});
  else{
   engine.projectUrl=normalizeProjectUrl(request.project||engine.page.url());
   // connect() normally opened the requested project already. Never reload it.
   await backlog.reuseProjectTab(engine);
   await engine.waitForFlowShell();
  }
  if(!request.downloadOnly&&!request.reuseRefs&&!engine._refsGenerated&&!(existingState&&fs.existsSync(existingState)))await engine.uploadStoryRefs(jobs[0].scene);
  log(`OMNI_PROJECT_URL: ${engine.projectUrl}`);
  if(request.refsOnly){log('References ready. No video submitted.');return;}
  const project=engine.projectUrl.split('/project/')[1];
  const hash=backlog.fingerprint(jobs,request,engine.storyRefs);
  const stateFile=path.join(folder,`single_clip_omni_${project}_${from}_${to}.json`);
  let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
  if(state&&state.hash!==hash&&!request.downloadOnly)throw Error('Omni prompts/settings changed for this saved run. Use a new project to avoid mixing versions.');
  state=state||{hash,project:engine.projectUrl,submitted:[],completed:[],submitting:null,receipts:{}};
  state.receipts=state.receipts||{};
  const history=backlog.collect(folder,engine.projectUrl,allJobs,request,engine.storyRefs);
  state.receipts={...history.receipts,...state.receipts};
  for(const n of history.completed.filter(n=>n>=from&&n<=to)){
   if(!state.completed.includes(n))state.completed.push(n);
   if(!state.submitted.includes(n))state.submitted.push(n);
  }
  for(const n of history.submitted.filter(n=>n>=from&&n<=to))if(!state.submitted.includes(n))state.submitted.push(n);
  const persist=()=>{fs.writeFileSync(stateFile+'.tmp',JSON.stringify(state,null,2));fs.renameSync(stateFile+'.tmp',stateFile);};
  // Interrupted submits are checked against real source tiles before any retry.
  // Position only once, when necessary. Waiting never scrolls the generation tab.
  await engine.page.evaluate(installGridScroller);
  const position=await engine.page.evaluate(gridMetrics);
  if(position.top>10)await wheelGrid(engine.page,-100000);
  const states=async batch=>media.stateFor(await media.snapshot(engine.page),batch,state.receipts);
  const stopFailed=item=>{
   state.receipts[item.number]={...state.receipts[item.number],rejected:true,lastError:'Flow marked this generation failed.',failureText:item.tile.text,failedAt:new Date().toISOString()};
   persist();
   throw Error(`Scene ${item.number} failed in Flow. Automatic resubmission is blocked; completed clips are preserved.`);
  };
  const retryFailed=async item=>{
   state.retryCounts=state.retryCounts||{};
   if(failedRetry.blocked(item.tile?.text||state.receipts[item.number]?.failureText)||Number(state.retryCounts[item.number]||0)>=2)stopFailed(item);
   state.retryCounts[item.number]=Number(state.retryCounts[item.number]||0)+1;persist();
   state.receipts[item.number]=await failedRetry.retry(engine,allJobs[item.number-1],state.receipts[item.number],{log});
   delete state.receipts[item.number].rejected;persist();
  };
  const checkGeneration=async()=>{
   if(!activeJobs.length)return;
   const current=await states(activeJobs);
   const failed=current.find(s=>s.tile?.failed);
   if(failed)await retryFailed(failed);
  };
  const wantDownloads=!!((request.download||request.join||request.downloadOnly)&&!request.inspectOnly);
  if(wantDownloads)downloader=new UpscaledDownloader(engine,{folder,total:story.scenes.length,storyHash:crypto.createHash('sha256').update(JSON.stringify(allJobs.map(j=>j.prompt))).digest('hex'),log,checkGeneration});
  if(request.downloadOnly){await downloader.group(allJobs,state.receipts);log('All story Upscaled 720p downloads finished.');return;}
  const waitAll=async receipts=>{
   const batch=receipts.map(r=>allJobs.find(j=>j.number===(r.scene||r))).filter(Boolean);
   activeJobs=batch;
   const deadline=Date.now()+12*60*1000;let last='';
   while(Date.now()<deadline){
    const current=await states(batch);
    const failed=current.find(s=>s.tile?.failed);
    if(failed){await retryFailed(failed);continue;}
    const ready=current.filter(s=>s.tile?.ready).length;
    const status=`Current group: ${ready}/${batch.length} completed (no grid scrolling).`;
    if(status!==last){
     log(status);
     for(const item of current.filter(s=>!s.tile?.ready)){
      log(`Scene ${item.number}: ${!item.tile?'matching source prompt not found in mounted rows':item.tile.busy?'generation is still pending':'matched row; waiting for a completed video preview'}.`);
     }
     last=status;
    }
    if(ready===batch.length){
     for(const s of current){state.receipts[s.number]={...state.receipts[s.number],key:s.tile.key,assetId:s.tile.assetId};}persist();
     return {ready,failed:0,generating:0};
    }
    await sleep(5000);
   }
   throw Error('Current Omni group did not finish within 12 minutes. Checkpoint preserved.');
  };
  const pending=[...new Set([...state.submitted.filter(n=>!state.completed.includes(n)),...(state.submitting?[state.submitting]:[])])];
  let previous=allJobs.filter(j=>history.completed.includes(j.number)||state.completed.includes(j.number));
  if(pending.length){
   log('Checking previously submitted scenes once in a background tab; generation page stays still.');
   const rejected=pending.find(n=>state.receipts[n]?.rejected);
   if(rejected&&failedRetry.blocked(state.receipts[rejected].failureText||state.receipts[rejected].lastError))throw Error(state.receipts[rejected].lastError+' Resolve that Flow rejection before continuing. No duplicate submitted.');
   const pendingJobs=jobs.filter(j=>pending.includes(j.number));
   const result=await recovery.inspectProject(engine,pendingJobs,state.receipts,{log,keepOpen:true});
   try {
   fs.writeFileSync(path.join(folder,'omni_resume_source_check.json'),JSON.stringify({checkedAt:new Date().toISOString(),project:engine.projectUrl,pending,
     exhaustive:result.exhaustive,generatingSeen:result.generatingSeen,rows:result.tiles.map(t=>({assetId:t.assetId,text:t.text,ready:t.ready,busy:t.busy,failed:t.failed}))},null,2));
   for(const number of pending.filter(n=>result.found[n]?.failed)){
    const generationPage=engine.page;
    try{
     engine.page=result.page;await retryFailed({number,tile:result.found[number]});
     result.found[number]=media.locateJob(await media.snapshot(result.page),allJobs[number-1],state.receipts[number]);
    }finally{engine.page=generationPage;}
   }
   const fixed=recovery.reconcilePending(state,pending,result);
   fs.copyFileSync(stateFile,stateFile+'.before-source-recovery-'+Date.now());
   for(const number of fixed.completed){
    const tile=result.found[number];
    if(!state.submitted.includes(number))state.submitted.push(number);
    if(!state.completed.includes(number))state.completed.push(number);
    state.receipts[number]={...state.receipts[number],scene:number,assetId:tile.assetId,key:'',confirmedAt:new Date().toISOString()};
    log(`Scene ${number}: existing completed source confirmed; skipped.`);
   }
   for(const number of fixed.missing){
    state.submitted=state.submitted.filter(n=>n!==number);delete state.receipts[number];
    state.recoveredMissing=state.recoveredMissing||[];state.recoveredMissing.push({scene:number,checkedAt:new Date().toISOString()});
    log(`Scene ${number}: no tile anywhere in the quiet project. Clearing stale submission record; this missing scene will be submitted normally.`);
   }
   for(const n of fixed.waiting){
    if(!state.submitted.includes(n))state.submitted.push(n);
    state.receipts[n]={...state.receipts[n],scene:n,assetId:result.found[n].assetId,key:'',confirmedAt:new Date().toISOString()};
   }
   state.submitting=null;persist();
   if(fixed.waiting.length&&!request.inspectOnly){
    const position=await result.page.evaluate(bg.metrics);
    if(position.top>10)await result.page.evaluate(bg.scrollToPosition,0);
    const deadline=Date.now()+12*60*1000;let still=fixed.waiting;
    while(still.length&&Date.now()<deadline){
     const current=media.stateFor(await media.snapshot(result.page),jobs.filter(j=>still.includes(j.number)),state.receipts);
     const failed=current.find(s=>s.tile?.failed);
     if(failed){
      const generationPage=engine.page;
      try{engine.page=result.page;await retryFailed(failed);}finally{engine.page=generationPage;}
      continue;
     }
     for(const entry of current.filter(s=>s.tile?.ready)){
      if(!state.completed.includes(entry.number))state.completed.push(entry.number);
      state.receipts[entry.number]={...state.receipts[entry.number],assetId:entry.tile.assetId,key:''};
     }
     still=still.filter(n=>!state.completed.includes(n));persist();
     if(still.length)await sleep(5000);
    }
    if(still.length)throw Error('Previously submitted source did not finish in 12 minutes. No duplicate submitted.');
   }
   previous=allJobs.filter(j=>history.completed.includes(j.number)||state.completed.includes(j.number));
   } finally { await engine.page.bringToFront();await result.page.close(); }
  }
  if(request.inspectOnly){log('Resume inspection/repair finished. No clip generated or downloaded.');return;}
  // A stopped earlier RANGE can have submitted clips that finished after the
  // process exited. Verify those once; a new range must not lose that backlog.
  const olderPending=allJobs.filter(j=>j.number<from&&history.submitted.includes(j.number)&&!history.completed.includes(j.number));
  if(downloader&&olderPending.length){
   log('Checking earlier submitted scenes once for the Upscaled download backlog.');
   const older=await recovery.inspectProject(engine,olderPending,state.receipts,{log});
   if(!older.exhaustive)throw Error('Earlier source check was incomplete; no scene guessed.');
   for(const job of olderPending){
    const tile=older.found[job.number];
    if(tile?.ready){history.completed.push(job.number);state.receipts[job.number]={...state.receipts[job.number],key:'',assetId:tile.assetId};}
    else if(tile?.failed){await retryFailed({number:job.number,tile});await waitAll([{scene:job.number}]);history.completed.push(job.number);activeJobs=[];}
    else if(tile?.busy)throw Error(`Earlier scene ${job.number} is still generating. Resume after that group finishes; no duplicate submitted.`);
    else log(`Earlier scene ${job.number}: ${tile?.failed?'failed':'missing'} source; needs recovery before the story can be joined.`);
   }
   state.projectCompleted=[...new Set(history.completed)];persist();
   previous=allJobs.filter(j=>history.completed.includes(j.number)||state.completed.includes(j.number));
  }
  const remaining=jobs.filter(j=>!state.completed.includes(j.number));
  if(remaining.length)await runQueue(remaining,{
   sleep,
   submit:async job=>{
    // Same project, same composer: no goto/reload between prompts.
    await settings.prepareVideo(engine.page,{model:request.model,ratio:request.aspect||'9:16',resolution:request.resolution,log});
    await engine.removeIngredientChipsFromExtend();await engine.typePrompt(job.prompt);
    const attached=await engine.selectRefsForScene(job.scene,job.number);
    if(!attached)throw Error(`Scene ${job.number}: references missing. No video submitted.`);
    const before=await media.snapshot(engine.page);
    const excluded=before.flatMap(t=>[t.key,t.assetId].filter(Boolean));
    log(`Scene ${job.number}: submitting one standalone clip.`);
    state.submitting=job.number;state.receipts[job.number]={scene:job.number,excluded,attemptedAt:new Date().toISOString()};persist();
    await engine.clickStartGeneration();
    try {
     state.receipts[job.number]=await recovery.confirmSubmission(engine.page,job,state.receipts[job.number],{approve:()=>engine.autoApproveCredits()});
    } catch(error) {
     state.receipts[job.number].lastError=error.message;
     state.receipts[job.number].rejected=error.code==='FLOW_REJECTED';persist();throw error;
    }
    state.submitted.push(job.number);state.submitting=null;persist();
    log(`Scene ${job.number}: new matching Flow tile confirmed.`);
    return {scene:job.number};
   },
   whileGenerating:async(prior,current)=>{
    activeJobs=current;await checkGeneration();
    const savedPrevious=[...new Map([...previous,...prior].map(j=>[j.number,j])).values()];
    if(downloader&&savedPrevious.length){log('Current group is generating; downloading the preceding completed group as Upscaled 720p.');await downloader.group(savedPrevious,state.receipts);}
    previous=[];
   },
   waitForCompletion:waitAll,
   checkpoint:async event=>{
    if(event.phase==='completed'){
     state.completed.push(...event.scenes.map(j=>j.number));persist();
     log(`Group complete: ${jobs.filter(j=>state.completed.includes(j.number)).length}/${jobs.length} selected scenes.`);
    }
   },
   afterAll:async final=>{activeJobs=[];if(downloader)await downloader.group(final,state.receipts);}
  });
  else if(downloader){activeJobs=[];await downloader.group(previous,state.receipts);}
  log('All selected Omni clips completed'+(downloader?' and downloaded as verified Upscaled 720p.':'.'));
  if(request.join){
   if(!downloader.ledger.clips.length||!downloader.ledger.clips.every(e=>fs.existsSync(path.join(folder,'clips',e.file))))throw Error('Upscaled downloads are incomplete; join stopped.');
   if(downloader.ledger.clips.length!==story.scenes.length){log('Partial story downloaded. Joining waits for all story scenes.');return;}
   const manifestPath=path.join(folder,'clips','manifest.json');
   const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
   if(!manifest?.complete||manifest.projectUrl!==engine.projectUrl||manifest.route!=='Omni Upscaled 720p'
     ||downloader.ledger.clips.some(c=>crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,'clips',c.file))).digest('hex')!==c.sha256)){
    throw Error('Verified Omni Upscaled manifest is incomplete or stale; joining stopped.');
   }
   await child('join_clips.js',[path.join(folder,'clips')]);
  }
 }finally{if(downloader)await downloader.close();if(engine.browser)await engine.browser.disconnect();}
}
module.exports={promptsFor,run};
if(require.main===module)run(JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''))).then(()=>process.exit(0),e=>{console.error('SINGLE CLIP OMNI STOP:',e.message);process.exit(1);});
