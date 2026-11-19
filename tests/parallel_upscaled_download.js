const assert=require('node:assert/strict');
const {UpscaledDownloader}=require('../single_clip_omni_upscaled');

async function fixture(failSetup=false,duplicate=false,noTransfer=false,canceled=false){
 const tabs=[],seen=[],serial=[];
 const jobs=[1,2,3,4,5].map(number=>({number}));
 const title=number=>'V3_012345abcdef_S00'+number;
 const preview=number=>'current-'+String(number).repeat(64);
 const receipts=Object.fromEntries(jobs.map(({number})=>[number,{assetId:'original-'+String(number).repeat(64),sceneId:title(number)}]));
 const inventory=jobs.map(({number})=>({assetTitle:title(number),assetId:preview(number),ready:true}));
 if(duplicate)inventory.push({assetTitle:title(4),assetId:preview(6),ready:true});
 let active=0,peak=0;
 const d={
  total:jobs.length,downloadVersion:'upscaled',orderMode:'scene',project:'https://flow.google.com/project/test',
  downloadFrames:new Map(),log:()=>{},open:async()=>{},
  engine:{page:{bringToFront:async()=>{}},browser:{newPage:async()=>{
   const number=tabs.length+1;
   const page={evaluate:async()=>inventory,closed:false,close:async()=>{page.closed=true;},goto:async()=>{},
    waitForSelector:async()=>{if(failSetup&&number===2)throw Error('no grid');},
    target:()=>({createCDPSession:async()=>({
     send:async()=>({frameTree:{frame:{id:'frame-'+number}}}),detach:async()=>{},
    })})};
   tabs.push(page);return page;
  }}},
  async group(jobs){
   if(!this.parallelWorker){
    assert(tabs.every(page=>page.closed));
    assert.equal(this.downloadFrames.size,0);
    serial.push(...jobs.map(j=>j.number));return;
   }
   const number=jobs[0].number;
   assert.equal(this.parallelAssets.get(title(number)),duplicate?undefined:preview(number));
   if(duplicate&&number===4){const e=Error('source unavailable in worker');e.code='PARALLEL_ASSET_UNAVAILABLE';throw e;}
   if(canceled&&number===2){const e=Error('browser canceled');e.code='DOWNLOAD_CANCELED';throw e;}
   active++;peak=Math.max(peak,active);seen.push(jobs[0].number);
   await new Promise(resolve=>setTimeout(resolve,20));active--;
   if(noTransfer&&number===4){
    const error=Error('no browser transfer started');error.code='DOWNLOAD_NOT_STARTED';throw error;
   }
  },
 };
 await UpscaledDownloader.prototype.parallelGroup.call(d,jobs,receipts);
 assert(tabs.length===(failSetup?2:3)&&tabs.every(page=>page.closed));
 assert.equal(d.downloadFrames.size,0);
 if(failSetup){
  assert.deepEqual(seen,[]);
  assert.deepEqual(serial,[1,2,3,4,5]);
 }else{
  assert.equal(peak,3);
  assert.deepEqual(seen,duplicate?[1,2,3,5]:canceled?[1,3,4,5]:[1,2,3,4,5]);
  assert.deepEqual(serial,duplicate||noTransfer?[4]:canceled?[2]:[]);
 }
}

(async()=>{await fixture();await fixture(true);await fixture(false,true);await fixture(false,false,true);await fixture(false,false,false,true);console.log('PASS: Agent upscale uses at most three workers and falls back before clicking when setup is unavailable.');})()
.catch(error=>{console.error(error);process.exitCode=1;});
