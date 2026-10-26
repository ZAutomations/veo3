const fs=require('fs');
function reviewWasSubmitted(submissionFile){
 if(!submissionFile)return false;
 try{
  const intent=JSON.parse(fs.readFileSync(submissionFile,'utf8'));
  const receipt=JSON.parse(fs.readFileSync(submissionFile+'.safety-review.json','utf8'));
  return receipt.fingerprint===intent.fingerprint&&receipt.from===intent.from&&receipt.to===intent.to;
 }catch{return false;}
}
function followupPlan(snapshot,submissionFile){
 const mt=snapshot.mediaTiles||{};
 const refusal=require('./agent_recovery_control').latestRefusal(snapshot);
 if(!submissionFile||mt.agent_busy||mt.generating_video_tile>0||(!mt.failed_video_tile&&!refusal)||mt.project_scan_complete!==true)return null;
 const intent=JSON.parse(fs.readFileSync(submissionFile,'utf8'));
 if(mt.ready_video_tile>=intent.to)return null;
 if(!Number.isInteger(intent.from)||!Number.isInteger(intent.to))throw Error('Scene range unavailable for blocked-scene review.');
 const file=submissionFile+'.safety-review.json';
 let reviewNumber=1;
 if(reviewWasSubmitted(submissionFile)){
  const prior=JSON.parse(fs.readFileSync(file,'utf8'));
  let baseline=prior.ready;
  // Migrate older receipts using their paired exact missing-scene selection.
  if(!Number.isInteger(baseline)){
   try{
    const missing=JSON.parse(fs.readFileSync(submissionFile+'.missing.json','utf8'));
    if(Array.isArray(missing.numbers)&&missing.numbers.length
       &&missing.numbers.every(n=>Number.isInteger(n)&&n>=intent.from&&n<=intent.to)
       &&Date.parse(missing.at)<=Date.parse(prior.at))baseline=intent.to-new Set(missing.numbers).size;
   }catch{}
  }
  if((prior.reviewNumber||1)>=2||!Number.isInteger(baseline)||mt.ready_video_tile<=baseline||!mt.failed_video_tile)return null;
  reviewNumber=2;
 }
 let instructions=require('./agent_safety_revision');
 if(reviewNumber===2)instructions=instructions
  .replace('ONE substantive safety revision','ONE final substantive safety revision')
  .replace('If it is refused again, stop that scene and report it.', 'If this final revision is refused, stop that scene and report it; do not retry again.');
 const progress=reviewNumber===2?`The previous review made verified progress. Exactly ${intent.to-mt.ready_video_tile} scene(s) remain incomplete. This authorizes one final substantive safety revision for ONLY those currently failed scenes, replacing the earlier one-review limit. Identify their original scene numbers from individual results before generation. Do not repeat any successful or still-running scene. `:'';
 return {file,reviewNumber,ready:mt.ready_video_tile,from:intent.from,to:intent.to,fingerprint:intent.fingerprint,text:progress+`FAILED-SCENE REVIEW ONLY for the existing batch, scenes ${intent.from}-${intent.to}. Inspect its individual tool results and identify the exact failed scene numbers from their original instructions. Preserve all successful clips. Do not generate a scene whose failure or identity cannot be verified. For a transient failure, use its individual retry. For a policy refusal, apply the following bounded safety revision, only within the review limit stated in this request; if that limit is exhausted, stop and report it. Use the original batch's reference images, voice and video settings. Never repeat the whole batch or any successful scene. Do not click conversation-level Try again.\n`+instructions};
}
function mark(plan){
 fs.writeFileSync(plan.file+'.tmp',JSON.stringify({status:'submitting',reviewNumber:plan.reviewNumber,ready:plan.ready,from:plan.from,to:plan.to,fingerprint:plan.fingerprint,at:new Date().toISOString()}));
 fs.renameSync(plan.file+'.tmp',plan.file);
}
module.exports={followupPlan,mark,reviewWasSubmitted};
