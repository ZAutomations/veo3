const fs=require('fs'),crypto=require('crypto');
const media=require('./single_clip_omni_media');
function planMissing(story,intent,result){
 if((!result.exhaustive&&!result.targetsVerified)||result.generatingSeen||result.unidentifiedSources)throw Error('Missing-scene recovery needs a complete, idle project with identified source prompts. Nothing resubmitted.');
 const jobs=story.scenes.slice(0,intent.to).map((scene,i)=>({number:i+1,scene,sceneId:require('./agent_scene_ids').sceneId(story,i+1),prompt:scene.veo3_prompt||scene.script_line||''}));
 const completed=[],missing=[],byScene=new Map();
 for(const tile of result.tiles){
  // A refused generation has no playable asset URL. Its exact scene/source
  // identity is still required below before authorizing a safety revision.
  if(tile.busy||(!tile.assetId&&!tile.failed))throw Error('A video is pending or unidentified. No scene will be resubmitted.');
  const matches=jobs.filter(job=>media.promptMatches(tile,job));
  if(matches.length!==1)throw Error(`RECOVERY_REVIEW_REQUIRED: Existing clip ${tile.assetId} does not map uniquely to story scenes (matches: ${matches.map(j=>j.number).join(', ')||'none'}). Nothing resubmitted.`);
  const number=matches[0].number,record=byScene.get(number)||{ready:0,failed:0};
  if(tile.failed)record.failed++;
  else if(tile.ready)record.ready++;
  else throw Error('A video state is unknown. No scene will be resubmitted.');
  byScene.set(number,record);
 }
 for(const [number,record] of byScene)if(record.ready)completed.push(number);
 for(let n=1;n<=intent.to;n++){
  if(n<intent.from&&!byScene.get(n)?.ready)throw Error('An earlier completed scene is missing. Current batch not resubmitted.');
  if(n>=intent.from&&!byScene.get(n)?.ready)missing.push(n);
 }
 return {completed:completed.sort((a,b)=>a-b),missing};
}
function missingPrompt(text,numbers){
 const matches=[...text.matchAll(/^Scene[ \t]+(\d+)(?:[ \t]*:[ \t]*|[ \t]+[-\u2014\u2013][ \t]+[^\r\n]*|[ \t]*)\r?$/gm)];
 if(!matches.length)throw Error('Numbered scene instructions unavailable.');
 const ids=matches.map(m=>Number(m[1]));
 if(new Set(ids).size!==ids.length)throw Error('Duplicate numbered scene instructions; recovery stopped.');
 const selected=numbers.map(n=>{
  const i=matches.findIndex(m=>Number(m[1])===n);if(i<0)throw Error(`Saved scene ${n} instructions missing.`);
  return text.slice(matches[i].index,i+1<matches.length?matches[i+1].index:text.length);
 });
 const header=text.slice(0,matches[0].index).replace(/^BATCH ONLY:.*$/gm,'').replace(/^Create exactly \d+ separate clips.*$/gm,'');
 return `${header}\nRECOVERY ONLY: Generate ONLY scenes ${numbers.join(', ')} below, exactly one clip per scene. All other scenes already exist and MUST NOT be generated. This selection replaces any original batch count. Track each requested scene through completion; retry only a failed individual scene. Never repeat the whole batch. Follow BLOCKED SCENE HANDLING for a content-policy refusal.\n\n${selected.join('\n')}`;
}
async function prepare({engine,storyFile,submissionFile,text,inspect,wait}){
 const source=fs.readFileSync(storyFile,'utf8'),story=JSON.parse(source),intent=JSON.parse(fs.readFileSync(submissionFile,'utf8'));
 if(crypto.createHash('sha256').update(source).digest('hex')!==intent.fingerprint)throw Error('Story fingerprint changed; missing-scene recovery stopped.');
 const jobs=story.scenes.slice(0,intent.to).map((scene,i)=>({number:i+1,scene,sceneId:require('./agent_scene_ids').sceneId(story,i+1),prompt:scene.veo3_prompt||scene.script_line||''}));
 const first=planMissing(story,intent,await inspect(engine,jobs));
 if(!first.missing.length)return null;
 await wait(8000);
 const second=planMissing(story,intent,await inspect(engine,jobs));
 if(JSON.stringify(first)!==JSON.stringify(second))throw Error('Project changed during missing-scene confirmation. Nothing resubmitted.');
 const receiptFile=submissionFile+'.missing.json';
 let receipt;try{receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));}catch{}
 if(receipt?.status==='submitting'&&receipt.numbers.some(n=>second.missing.includes(n)))throw Error('RECOVERY_REVIEW_REQUIRED: Previous missing-scene submission is unconfirmed. Nothing repeated; inspect the Agent response before retrying.');
 const prompt=missingPrompt(text,second.missing);
 return {...second,prompt,receiptFile};
}
function markSubmitting(plan,context={}){
 const snapshot=context.snapshot||{};
 const agents=(snapshot.conversationRows||[]).filter(row=>row.role==='agent');
 let prior={};try{prior=JSON.parse(fs.readFileSync(plan.receiptFile,'utf8'));}catch{}
 fs.writeFileSync(plan.receiptFile+'.tmp',JSON.stringify({status:'submitting',numbers:plan.missing,at:new Date().toISOString(),
  attempt:(Number(prior.attempt)||0)+1,
  priorAgentCount:agents.length,priorAgentText:agents.at(-1)?.text||'',
  priorReadyVideos:Number(snapshot.mediaTiles?.ready_video_tile)||0,
  priorGeneratingVideos:Number(snapshot.mediaTiles?.generating_video_tile)||0,
  priorFlowVideos:Number(snapshot.mediaTiles?.flow_video_tile)||0,
  priorFailedVideos:Number(snapshot.mediaTiles?.failed_video_tile)||0,
  priorPolicyCount:Array.isArray(snapshot.mediaTiles?.failed_policy_texts)?snapshot.mediaTiles.failed_policy_texts.length:0,
  priorVisibleRefusalCount:Array.isArray(snapshot.policyRefusals)?snapshot.policyRefusals.length:0}));
 fs.renameSync(plan.receiptFile+'.tmp',plan.receiptFile);
}
function confirmObservedSubmission(submissionFile,snapshot){
 if(!submissionFile||!snapshot)return false;
 let receipt;try{receipt=JSON.parse(fs.readFileSync(submissionFile+'.missing.json','utf8'));}catch{return false;}
 if(receipt?.status!=='submitting')return receipt?.status==='confirmed';
 const agents=(snapshot.conversationRows||[]).filter(row=>row.role==='agent');
 const newAgents=agents.slice(Number(receipt.priorAgentCount)||0);
 const acknowledged=newAgents.some(row=>/\b(?:submitted|resubmitted|queued|generated|generating|created|started|refused|blocked|rejected|failed)\b/i.test(String(row.text||'')));
 const mt=snapshot.mediaTiles||{};
 const increased=(key,prior)=>Object.hasOwn(receipt,prior)&&Number(mt[key]||0)>Number(receipt[prior]||0);
 const tileChanged=increased('ready_video_tile','priorReadyVideos')
  ||increased('generating_video_tile','priorGeneratingVideos')
  ||increased('flow_video_tile','priorFlowVideos')
  ||increased('failed_video_tile','priorFailedVideos');
 const policyChanged=(Array.isArray(mt.failed_policy_texts)?mt.failed_policy_texts.length:0)>Number(receipt.priorPolicyCount||0)
  ||(Array.isArray(snapshot.policyRefusals)?snapshot.policyRefusals.length:0)>Number(receipt.priorVisibleRefusalCount||0);
 if(!acknowledged&&!tileChanged&&!policyChanged)return false;
 receipt.status='confirmed';receipt.confirmedAt=new Date().toISOString();
 receipt.confirmation=acknowledged?'new-agent-response':tileChanged?'project-tile-change':'new-policy-result';
 fs.writeFileSync(submissionFile+'.missing.json.tmp',JSON.stringify(receipt));
 fs.renameSync(submissionFile+'.missing.json.tmp',submissionFile+'.missing.json');
 return true;
}
function pendingSubmission(submissionFile,snapshot){
 if(!submissionFile)return null;
 let receipt;try{receipt=JSON.parse(fs.readFileSync(submissionFile+'.missing.json','utf8'));}catch(error){
  if(error.code==='ENOENT')return null;
  throw Error('Missing-scene receipt could not be read; generation paused: '+error.message);
 }
 if(receipt?.status==='submitting'&&confirmObservedSubmission(submissionFile,snapshot))return null;
 return receipt?.status==='submitting'?receipt:null;
}
function recoveryOwnsRetries(submissionFile){
 if(!submissionFile)return null;
 let receipt,intent;
 try{
  receipt=JSON.parse(fs.readFileSync(submissionFile+'.missing.json','utf8'));
  intent=JSON.parse(fs.readFileSync(submissionFile,'utf8'));
 }catch(error){
  if(error.code==='ENOENT')return null;
  throw Error('RECOVERY_REVIEW_REQUIRED: Recovery ownership checkpoint is unreadable; no second retry path allowed. '+error.message);
 }
 const numbers=receipt?.numbers;
 if(!['submitting','confirmed'].includes(receipt?.status)||!Array.isArray(numbers)||!numbers.length)return null;
 if(!Number.isInteger(intent.from)||!Number.isInteger(intent.to)||!numbers.every(n=>Number.isInteger(n)&&n>=intent.from&&n<=intent.to))return null;
 // Confirmed means accepted/queued, not that every requested scene finished.
 // Once revised prompts own this batch, never click its old failed tiles too.
 return receipt;
}
module.exports={planMissing,missingPrompt,prepare,markSubmitting,confirmObservedSubmission,pendingSubmission,recoveryOwnsRetries};
