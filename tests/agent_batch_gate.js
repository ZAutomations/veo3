const assert=require('assert'),{waitForReady}=require('../agent_batch_gate');
const snap=(ready,complete=true,busy=false)=>({mediaTiles:{ready_video_tile:ready,flow_video_tile:ready,generating_video_tile:0,failed_video_tile:0,agent_busy:busy,project_scan_complete:complete}});
(async()=>{
 for(const needed of [0,5,10]){let time=0,reads=0;const result=await waitForReady({needed,timeoutMs:12000,now:()=>time,wait:async ms=>{time+=ms},read:async full=>{assert.equal(full,true);reads++;return snap(needed,full)}});assert.equal(result.confirmed,2);assert.equal(reads,2);assert.equal(time,4000);}
 let time=0,read=0;const pending=await waitForReady({needed:5,timeoutMs:20000,now:()=>time,wait:async ms=>time+=ms,read:async()=>snap(5,++read>2)});assert.equal(pending.confirmed,2);
 time=0;const incomplete=await waitForReady({needed:0,timeoutMs:10000,now:()=>time,wait:async ms=>time+=ms,read:async()=>snap(0,false)});assert.equal(incomplete.confirmed,0,'unknown empty grid cannot permit submission');
 const duplicates=await waitForReady({needed:5,timeoutMs:10000,read:async()=>snap(6),wait:async()=>{throw Error('duplicate inventory should stop immediately')}});assert.equal(duplicates.confirmed,0);
 console.log('PASS: first empty batch and later batches pass two full inventories; partial inventory cannot pass; duplicates stop without submission.');
})().catch(e=>{console.error(e);process.exitCode=1});
