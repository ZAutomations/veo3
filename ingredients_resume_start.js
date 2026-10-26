// Reference preparation and clip generation are separate phases. Images alone
// never authorize editor/timeline resume or imply clip 1 was submitted.
function gridState(){
 const videos=[...document.querySelectorAll('flow-video-tile')];
 return {videos:videos.length,images:document.querySelectorAll('flow-image-tile').length,
  pending:videos.some(t=>/generating|queued|processing|\b\d{1,3}%/i.test(t.innerText||t.textContent||'')),
  stop:[...document.querySelectorAll('button')].some(b=>/^stop(?: generation)?$/i.test((b.getAttribute('aria-label')||b.innerText||'').trim())),
  failed:videos.some(t=>/failed|might violate|may violate|unusual activity/i.test(t.innerText||t.textContent||'')),
  ready:videos.filter(t=>/play_circle|play_arrow/i.test(t.innerText||t.textContent||'')||t.querySelector('video[src],img[aria-label="Generated video thumbnail"]')).length,
  composer:!!document.querySelector('.ProseMirror,[contenteditable="true"],textarea'),
  loading:!!document.querySelector('flow-project-page mat-progress-spinner')};
}
async function prepare(engine,{log=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),timeout=720000}={}){
 const pages=await engine.browser.pages();
 const editor=pages.find(p=>engine.isEditorUrl(p.url())&&(!engine.projectUrl||p.url().startsWith(engine.projectUrl+'/')));
 if(editor){engine.page=editor;await engine.ensureEditor();return engine.countCompletedClips();}
 if(engine.projectUrl&&!engine.page.url().startsWith(engine.projectUrl))await engine.gotoProject();
 await engine.page.waitForSelector('flow-video-tile,flow-image-tile,.ProseMirror,textarea',{timeout:30000});
 const deadline=Date.now()+timeout;let last='';
 while(Date.now()<deadline){
  const state=await engine.page.evaluate(gridState);
  if(state.failed)throw Error('RECOVERY_REVIEW_REQUIRED: Ingredients resume found a failed first video. Review/retry that existing asset; no new clip was submitted.');
  if(!state.videos&&!state.pending&&!state.stop&&!state.loading&&(state.images||state.composer)){
   engine.fromScene=1;engine.skipRefs=false;engine.opts.noUploadRefs=true;
   engine._refsGenerated=state.images>0;engine.opts.autoStart=true;
   log('Retry / Continue: project has reference images but no video. Starting clip 1 with the existing images; editor opens only after generation completes.');
   return 0;
  }
  if(state.videos&&state.ready===state.videos&&!state.pending&&!state.stop){
   const tiles=await require('./ingredients_first_clip').snapshot(engine.page);
   const ready=tiles.filter(t=>t.ready&&!t.busy&&!t.failed);
   if(ready.length!==1)throw Error('RECOVERY_REVIEW_REQUIRED: The project has multiple video assets but no open timeline. Open the intended existing clip; no new clip submitted.');
   await require('./ingredients_first_clip').openCompleted(engine,ready[0],{log,wait});return engine.countCompletedClips();
  }
  const status=`${state.videos} video(s), ${state.ready} completed`;
  if(status!==last){log('Waiting for the previously submitted first clip: '+status+'. No prompt repeated.');last=status;}
  await wait(3000);
 }
 throw Error('RECOVERY_REVIEW_REQUIRED: Could not confirm the existing first clip completed. No duplicate video was submitted.');
}
function checkModel(opts){
 if(opts.refsOnly||opts.exportOnly)return;
 const model=opts.videoModel||'Flow';
 if(model!=='Flow'&&!/^Veo 3\.1 - (?:Lite|Fast)(?:\s|$)/i.test(model))throw Error(`RECOVERY_REVIEW_REQUIRED: Ingredients + Extend cannot use "${model}". Select Veo 3.1 - Lite or Veo 3.1 - Fast in Ingredients, keep this existing project, then click Generate clips. Reference images are preserved. Retry / Continue retains the old model selection.`);
}
module.exports={gridState,prepare,checkModel};
