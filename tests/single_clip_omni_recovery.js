const assert=require('assert'),vm=require('vm'),fs=require('fs'),path=require('path');
const actual=require('../single_clip_omni_recovery');
assert.deepEqual(actual.reconcilePending({},[12],{exhaustive:true,generatingSeen:false,found:{12:null}}),{completed:[],missing:[12],waiting:[]});
assert.deepEqual(actual.reconcilePending({},[12],{exhaustive:true,generatingSeen:false,found:{12:{ready:true}}}),{completed:[12],missing:[],waiting:[]});
assert.deepEqual(actual.reconcilePending({},[12],{exhaustive:false,generatingSeen:false,found:{12:{ready:true}}}),{completed:[12],missing:[],waiting:[]});
assert.throws(()=>actual.reconcilePending({},[12],{exhaustive:false,generatingSeen:false,found:{}}),/incomplete/);
assert.throws(()=>actual.reconcilePending({},[12],{exhaustive:true,generatingSeen:true,found:{}}),/another generation/);
assert.throws(()=>actual.reconcilePending({},[12],{exhaustive:true,generatingSeen:false,unidentifiedSources:true,found:{}}),/no matching source/,'a generated caption is not proof that a submitted clip is missing');
assert.throws(()=>actual.reconcilePending({},[12],{exhaustive:true,generatingSeen:false,found:{12:{failed:true}}}),/failed tile/);
const mod={exports:{}};
let frames=0;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../single_clip_omni_recovery.js'),'utf8'),{
 module:mod,require:n=>n==='./single_clip_omni_media'?{snapshot:async()=>{frames++;return frames>1?[{key:'new'}]:[];},locateJob:t=>t[0]}:{},setTimeout,Date
});
(async()=>{
 const jobs=[1,2,3,4,5].map(n=>({number:n,prompt:`Prompt ${n}`}));
 const tiles=jobs.map(j=>({assetId:`asset-${j.number}`,key:`background-${j.number}`,text:j.prompt,ready:true}));
 let scrolled=0;
 const page={goto:async()=>{},bringToFront:async()=>{},waitForSelector:async()=>{},close:async()=>{},evaluate:async(fn)=>{
  if(fn.name==='metrics')return {top:0,client:600,scroll:1046,visible:true};
  if(fn.name==='tileSnapshot')return tiles;
  if(fn.name==='scrollToPosition')scrolled++;
 }};
 const inspection=await actual.inspectProject({browser:{newPage:async()=>page},projectUrl:'https://flow.google.com/project/test',page},jobs,{}, {sleep:async()=>{}});
 assert(inspection.targetsVerified);assert(!inspection.exhaustive);assert.equal(scrolled,0,'all five matched sources require no scrolling even with a nonmoving scroll host');
 assert.deepEqual(actual.reconcilePending({},jobs.map(j=>j.number),inspection).completed,[1,2,3,4,5]);
 let cleaned=0;const originalClose=page.close;page.close=async()=>{cleaned++;};
 const closedOrigin={bringToFront:async()=>{throw Error('Session closed');}};
 const recovered=await actual.inspectProject({browser:{newPage:async()=>page},projectUrl:'https://flow.google.com/project/test',page:closedOrigin},jobs,{}, {sleep:async()=>{}});
 assert(recovered.targetsVerified);assert.equal(cleaned,1,'inspection closes even when the original browser tab has gone');page.close=originalClose;
 const receipt=await mod.exports.confirmSubmission({evaluate:async()=>''}, {number:12}, {}, {timeout:100,sleep:async()=>{}});
 assert.equal(receipt.key,'new');assert(receipt.confirmedAt);
 frames=0;await assert.rejects(mod.exports.confirmSubmission({evaluate:async()=>''}, {number:12}, {}, {timeout:0}),/no new matching clip tile/);
 console.log('PASS: real tile required for submission; completed sources skipped; only exhaustive quiet absence can repair a missing submission; failures/unknown state never repeated.');
})().catch(e=>{console.error(e);process.exitCode=1;});
