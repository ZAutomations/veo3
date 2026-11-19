const assert=require('node:assert/strict');
const {UpscaledDownloader}=require('../single_clip_omni_upscaled');
async function run(missing){
 const jobs=Array.from({length:7},(_,i)=>({number:i+1})),checked=[],transferred=[],tabs=[];
 const title=n=>'V3_012345abcdef_S00'+n,asset=n=>'original-'+String(n).repeat(64);
 const receipts=Object.fromEntries(jobs.map(j=>[j.number,{assetId:asset(j.number),sceneId:title(j.number)}]));
 const inventory=jobs.map(j=>({assetTitle:title(j.number),assetId:asset(j.number),ready:true}));
 let opened=0;
 const d={total:7,project:'https://flow.google.com/project/test',orderMode:'scene',downloadVersion:'upscaled',downloadFrames:new Map(),log:()=>{},checkGeneration:async()=>{},open:async()=>{opened++;},
  reuseLocal:async job=>{checked.push(job.number);return missing.includes(job.number)?null:{scene:job.number};},
  group:async function(group){transferred.push(...group.map(j=>j.number));},
  engine:{page:{bringToFront:async()=>{}},browser:{newPage:async()=>{
   const n=tabs.length+1,page={goto:async()=>{},waitForSelector:async()=>{},evaluate:async()=>inventory,close:async()=>{page.closed=true;},target:()=>({createCDPSession:async()=>({send:async()=>({frameTree:{frame:{id:'frame-'+n}}}),detach:async()=>{}})})};tabs.push(page);return page;
  }}}};
 await UpscaledDownloader.prototype.parallelGroup.call(d,jobs,receipts);
 assert.deepEqual(checked,[1,2,3,4,5,6,7]);assert.deepEqual(transferred.sort((a,b)=>a-b),missing);
 assert.equal(tabs.length,missing.length<2?0:Math.min(missing.length,3));assert(tabs.every(p=>p.closed));
 if(!missing.length)assert.equal(opened,0,'all saved clips must bypass every browser tab');
}
(async()=>{await run([]);await run([7]);await run([4,7]);console.log('PASS: check all local receipts before browser access; 0 missing opens no tabs, 1 uses serial, 2 opens only 2 workers; saved scenes are never queued.');})().catch(e=>{console.error(e);process.exitCode=1;});
