const media=require('./single_clip_omni_media');
function newlyCompleted(tiles,before=[]){
 const previousIds=new Set(before.map(t=>t.assetId).filter(Boolean));
 const fresh=tiles.filter(t=>t.assetId&&!previousIds.has(t.assetId));
 if(fresh.some(t=>t.failed))throw Error('RECOVERY_REVIEW_REQUIRED: The newly submitted first clip failed. Retry that existing clip; no duplicate was submitted.');
 const ready=fresh.filter(t=>t.ready&&!t.busy);
 if(ready.length>1)throw Error('RECOVERY_REVIEW_REQUIRED: Multiple new completed videos appeared for clip 1. No arbitrary clip selected.');
 return ready[0]||null;
}
function clickTile(target){
 const tiles=[...document.querySelectorAll('flow-video-tile')];
 const hits=tiles.filter(t=>window.__singleOmniTileKeys?.keys.get(t)===target.key||target.assetId&&[...t.querySelectorAll('img,video,source')].some(e=>(e.currentSrc||e.getAttribute('src')||'').includes('/'+target.assetId)));
 if(hits.length!==1)return false;
 hits[0].click();return true;
}
async function openCompleted(engine,tile,{log=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),timeout=25000}={}){
 if(!tile?.ready||tile.busy||tile.failed)throw Error('RECOVERY_REVIEW_REQUIRED: Clip is not confirmed completed; editor was not opened.');
 if(!await engine.page.evaluate(clickTile,tile))throw Error('RECOVERY_REVIEW_REQUIRED: Completed clip could not be selected by its actual asset ID. No new video submitted.');
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  const pages=await engine.browser.pages();
  const editor=pages.find(p=>engine.isEditorUrl(p.url())&&(!engine.projectUrl||p.url().startsWith(engine.projectUrl+'/')));
  if(editor){engine.page=editor;await engine.waitForEditorReady();await engine.clickNewestClip();engine._editorSeen=true;log('First clip completed; its editor is ready. Continuing with Extend.');return;}
  await wait(500);
 }
 throw Error('RECOVERY_REVIEW_REQUIRED: First clip is already generated, but its editor did not open. Retry will reuse the existing clip, not generate it again.');
}
module.exports={newlyCompleted,clickTile,openCompleted,snapshot:media.snapshot};
