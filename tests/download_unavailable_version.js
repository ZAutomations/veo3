const assert=require('assert');
const {chooseUpscaled,UpscaledDownloader}=require('../single_clip_omni_upscaled');
(async()=>{
 assert.throws(()=>chooseUpscaled([{text:'270p\nAnimated GIF'},{text:'4K\nOriginal size'}],720,{versionOnly:true}),e=>e.code==='DOWNLOAD_VERSION_UNAVAILABLE'&&e.message.includes('4K Original size'));
 assert.equal(chooseUpscaled([{text:'720p Original size'},{text:'1080p Upscaled'}],720,{versionOnly:true}).text,'1080p Upscaled');
 assert.equal(chooseUpscaled([{text:'720p Upscaled'},{text:'1080p Upscaled'}],720,{versionOnly:true}).text,'720p Upscaled');
 const visited=[],saved=[],log=[];
 const fake={targets:new Map(),orderMode:'unresolved-assets',downloadVersion:'upscaled',upscaleFromSource:true,targetResolution:720,
  engine:{page:{bringToFront:async()=>{}}},page:{keyboard:{press:async()=>{}},evaluate:async()=>{}},checkGeneration:async()=>{},log:m=>log.push(m),
  download:async job=>{visited.push(job.number);if(job.number===1){const e=Error('Available: 4K Original size');e.code='DOWNLOAD_VERSION_UNAVAILABLE';throw e;}saved.push(job.number);}};
 await assert.rejects(UpscaledDownloader.prototype.group.call(fake,[{number:1},{number:2},{number:3}],{1:{assetId:'uploaded-source'}}),e=>e.code==='DOWNLOAD_VERSION_UNAVAILABLE'&&e.message.includes('RECOVERY_REVIEW_REQUIRED')&&e.message.includes('uploaded-source'));
 assert.deepEqual(visited,[1,2,3]);assert.deepEqual(saved,[2,3]);assert(log.some(x=>x.includes('No generation or Original substitution')));
 fake.download=async()=>{throw Error('Source identity ambiguous');};
 await assert.rejects(UpscaledDownloader.prototype.group.call(fake,[{number:1},{number:2}],{}),/Source identity ambiguous/);
 console.log('PASS: 4K Original-only menu gives an actionable version error; remaining clips are collected; identity and quality protections retained.');
})().catch(e=>{console.error(e);process.exitCode=1;});
