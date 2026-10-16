const assert=require('assert');
const {UpscaledDownloader}=require('../single_clip_omni_upscaled');
(async()=>{
 const calls=[];let first=true;
 const fake={targets:new Map(),receipts:{},log:()=>{},engine:{page:{bringToFront:async()=>{}}},page:{keyboard:{press:async()=>{}}},checkGeneration:async()=>{},
  download:async job=>{calls.push(job.number);if(job.number===2&&first){first=false;const e=Error('no transfer');e.code='DOWNLOAD_NOT_STARTED';throw e;}}};
 await UpscaledDownloader.prototype.group.call(fake,[{number:1},{number:2},{number:3}],{});
 assert.deepEqual(calls,[1,2,2,3]);
 fake.download=async()=>{throw Error('Wrong source identity');};
 await assert.rejects(UpscaledDownloader.prototype.group.call(fake,[{number:4}],{}),/Wrong source identity/);
 console.log('PASS: retry only the stalled download once, continue to next scene, preserve identity errors as stops.');
})().catch(e=>{console.error(e);process.exitCode=1;});
