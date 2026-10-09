const assert=require('assert');
const {runQueue}=require('../single_clip_omni_queue');
(async()=>{
 const events=[];
 const scenes=Array.from({length:12},(_,i)=>i+1);
 await runQueue(scenes,{
  submit:async n=>{events.push(`submit:${n}`);return {scene:n};},
  sleep:async ms=>{assert.equal(ms,5000);events.push('gap');},
  waitForCompletion:async r=>{events.push(`wait:${r.length}`);return {ready:r.length,failed:0,generating:0};}
 });
 assert.equal(events.filter(e=>e==='gap').length,9);
 assert.deepEqual(events.filter(e=>e.startsWith('wait:')),['wait:5','wait:5','wait:2']);
 assert(events.indexOf('wait:5')<events.indexOf('submit:6'));
 const sent=[];
 await assert.rejects(runQueue(scenes,{
  submit:async n=>{sent.push(n);return {scene:n};},sleep:async()=>{},
  waitForCompletion:async()=>({ready:4,failed:1,generating:0})
 }),/incomplete or failed/);
 assert.deepEqual(sent,[1,2,3,4,5]);
 console.log('PASS: 5 standalone submissions, 5-second intervals, completion gate, and stop on failure.');
})().catch(e=>{console.error(e);process.exitCode=1;});
