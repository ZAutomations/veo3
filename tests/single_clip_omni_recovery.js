const assert=require('assert'),vm=require('vm'),fs=require('fs'),path=require('path');
const actual=require('../single_clip_omni_recovery');
assert.deepEqual(actual.reconcilePending({},[12],{exhaustive:true,generatingSeen:false,found:{12:null}}),{completed:[],missing:[12],waiting:[]});
assert.deepEqual(actual.reconcilePending({},[12],{exhaustive:true,generatingSeen:false,found:{12:{ready:true}}}),{completed:[12],missing:[],waiting:[]});
assert.throws(()=>actual.reconcilePending({},[12],{exhaustive:false,generatingSeen:false,found:{}}),/incomplete/);
assert.throws(()=>actual.reconcilePending({},[12],{exhaustive:true,generatingSeen:true,found:{}}),/another generation/);
assert.throws(()=>actual.reconcilePending({},[12],{exhaustive:true,generatingSeen:false,found:{12:{failed:true}}}),/failed tile/);
const mod={exports:{}};
let frames=0;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../single_clip_omni_recovery.js'),'utf8'),{
 module:mod,require:n=>n==='./single_clip_omni_media'?{snapshot:async()=>{frames++;return frames>1?[{key:'new'}]:[];},locateJob:t=>t[0]}:{},setTimeout,Date
});
(async()=>{
 const receipt=await mod.exports.confirmSubmission({evaluate:async()=>''}, {number:12}, {}, {timeout:100,sleep:async()=>{}});
 assert.equal(receipt.key,'new');assert(receipt.confirmedAt);
 frames=0;await assert.rejects(mod.exports.confirmSubmission({evaluate:async()=>''}, {number:12}, {}, {timeout:0}),/no new matching clip tile/);
 console.log('PASS: real tile required for submission; completed sources skipped; only exhaustive quiet absence can repair a missing submission; failures/unknown state never repeated.');
})().catch(e=>{console.error(e);process.exitCode=1;});
