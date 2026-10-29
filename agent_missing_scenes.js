const fs=require('fs'),crypto=require('crypto');
const media=require('./single_clip_omni_media');
function planMissing(story,intent,result){
 if((!result.exhaustive&&!result.targetsVerified)||result.generatingSeen||result.unidentifiedSources)throw Error('Missing-scene recovery needs a complete, idle project with identified source prompts. Nothing resubmitted.');
 const jobs=story.scenes.slice(0,intent.to).map((scene,i)=>({number:i+1,scene,sceneId:require('./agent_scene_ids').sceneId(story,i+1),prompt:scene.veo3_prompt||scene.script_line||''}));
 const completed=[],missing=[],byScene=new Map();
 for(const tile of result.tiles){
  if(tile.busy||!tile.assetId)throw Error('A video is pending or unidentified. No scene will be resubmitted.');
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
function markSubmitting(plan){
 fs.writeFileSync(plan.receiptFile+'.tmp',JSON.stringify({status:'submitting',numbers:plan.missing,at:new Date().toISOString()}));
 fs.renameSync(plan.receiptFile+'.tmp',plan.receiptFile);
}
module.exports={planMissing,missingPrompt,prepare,markSubmitting};
