// Read current Omni job tiles without scrolling, reloading, or scanning the project.
function tileSnapshot(){
 const store=window.__singleOmniTileKeys||(window.__singleOmniTileKeys={keys:new WeakMap(),next:0,session:typeof crypto?.randomUUID==='function'?crypto.randomUUID():`${Date.now()}-${Math.random()}`});
 return [...document.querySelectorAll('flow-video-tile')].map(tile=>{
  if(!store.keys.has(tile))store.keys.set(tile,`omni-${store.session}-${++store.next}`);
  // Flow's list layout places prompt and metadata beside the preview rather
  // than inside flow-video-tile. Walk only within a ONE-video row; never let a
  // neighbour's prompt/status identify this asset.
  let scope=tile;
  for(let node=tile.parentElement,depth=0;node&&depth<12;node=node.parentElement,depth++){
   const count=node.querySelectorAll('flow-video-tile').length;
   if(count>1)break;
   if(count===1)scope=node;
  }
  const text=scope.textContent||'';
  const sources=[...tile.querySelectorAll('video,source,img')].map(e=>e.currentSrc||e.getAttribute('src')||'');
  const assetId=(sources.join(' ').match(/\/(?:video|image|asb)\/([^=?/#\s]+)/)||[])[1]||'';
  const failed=/audio generation failed|failed to generate|generation failed|you have not been charged|unusual activity/i.test(text)
   ||!!scope.querySelector('[class*="generation-error"]');
  const videoSources=[...tile.querySelectorAll('video')].some(e=>!!(e.currentSrc||e.getAttribute('src')));
  const completedPreview=/play_circle|play_arrow/i.test(tile.textContent||'')
   ||!!tile.querySelector('img[aria-label="Generated video thumbnail"], [aria-label="Generated video thumbnail"]')
   ||videoSources;
  const explicitBusy=/(?:^|\n)\s*(?:generating|generation in progress|queued|processing|creating|\d{1,3}%)(?:\.{0,3})?\s*(?:\n|$)/i.test(scope.innerText||scope.textContent||'');
  // A video player can show a buffering spinner after generation completed.
  // That is not a generation queue; an explicit queue/progress message still wins.
  const busy=!failed&&(explicitBusy||(!completedPreview&&!!scope.querySelector('mat-progress-spinner,[role="progressbar"],[class*="spinner"]')));
  const ready=!failed&&!busy&&(completedPreview
   ||sources.some(s=>/^https?:/i.test(s)&&! /placeholder|loading|\.svg(?:[?#]|$)/i.test(s)));
  const r=tile.getBoundingClientRect();
  return {key:store.keys.get(tile),assetId,text,failed,busy,ready,x:r.x,y:r.y,width:r.width,height:r.height};
 });
}
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function promptMatches(tile,job){
 const text=norm(tile.text),prompt=norm(job.prompt);
 if(prompt&&(text===prompt||(prompt.length>=50&&text.includes(prompt))))return true;
 // Source prompts may omit the leading generation instruction; the exact spoken
 // lines still distinguish the scene. Short generic lines alone are insufficient.
 const lines=(job.scene?.dialogue||[]).map(d=>norm(d.line)).filter(t=>t.length>=18);
 return lines.length>0&&lines.every(line=>text.includes(line));
}
function locateJob(tiles,job,receipt=null){
 if(receipt){
  const direct=tiles.find(t=>(receipt.assetId&&t.assetId===receipt.assetId)||t.key===receipt.key);
  if(direct)return direct;
 }
 const excluded=new Set(receipt?.excluded||[]);
 const matches=tiles.filter(t=>promptMatches(t,job)&&!excluded.has(t.key)&&!(t.assetId&&excluded.has(t.assetId)));
 if(matches.length>1)throw Error(`Scene ${job.number}: multiple matching video tiles; refusing to guess.`);
 return matches[0]||null;
}
function stateFor(tiles,jobs,receipts={}){
 return jobs.map(job=>({number:job.number,tile:locateJob(tiles,job,receipts[job.number])}));
}
async function snapshot(page){return page.evaluate(tileSnapshot);}
module.exports={tileSnapshot,snapshot,promptMatches,locateJob,stateFor,norm};
