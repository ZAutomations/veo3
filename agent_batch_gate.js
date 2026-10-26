async function waitForReady({needed,read,wait,timeoutMs,onWait=()=>{},now=Date.now}){
 const deadline=now()+timeoutMs;let confirmed=0,snapshot;
 // This is a submission gate, not cheap progress polling. Each observation
 // must be a full inventory, otherwise cached checks invalidate one another.
 while(now()<deadline){
  snapshot=await read(true);const mt=snapshot.mediaTiles;
  if(mt.failed_video_tile>0||mt.ready_video_tile>needed||mt.flow_video_tile>needed)break;
  const complete=mt.ready_video_tile===needed&&mt.generating_video_tile===0&&!mt.agent_busy&&mt.project_scan_complete!==false;
  confirmed=complete?confirmed+1:0;
  if(confirmed>=2)break;
  if(!complete)onWait(mt);
  await wait(4000);
 }
 return {snapshot,confirmed};
}
module.exports={waitForReady};
