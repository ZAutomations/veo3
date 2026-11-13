const fs=require('fs'),crypto=require('crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function eligible(state,intent,snapshot,projectUrl){
 const mt=snapshot?.mediaTiles||{};
 return state?.completed===0&&state.durationReviewRequired===true&&state.durationExpectedSeconds===10
  &&state.pending?.from===1&&state.pending?.to===1&&intent?.from===1&&intent?.to===1
  &&state.fingerprint===intent.fingerprint
  &&String(projectUrl).split(/[?#]/)[0]===`https://flow.google.com/project/${state.project}`
  &&snapshot.agentOn===true&&mt.project_scan_complete===true&&mt.agent_busy===false
  &&['ready_video_tile','failed_video_tile','generating_video_tile','flow_video_tile'].every(k=>mt[k]===0);
}
async function confirm({submissionFile,storyFile,projectUrl,read,wait}){
 if(!submissionFile||!storyFile)return false;
 const stateFile=submissionFile.replace(/\.submission\.json$/,'');
 if(stateFile===submissionFile)return false;
 let state,intent,source;
 try{state=JSON.parse(fs.readFileSync(stateFile));intent=JSON.parse(fs.readFileSync(submissionFile));source=fs.readFileSync(storyFile);}
 catch{return false;}
 if(state.fingerprint!==hash(source))return false;
 // This exception is confined to the first duration-rejected render, not a
 // generic empty grid or a policy refusal. Never trust an empty viewport.
 if(!eligible(state,intent,await read(),projectUrl))return false;
 await wait(8000);
 if(!eligible(state,intent,await read(),projectUrl))return false;
 if(hash(fs.readFileSync(storyFile))!==state.fingerprint)return false;
 if(JSON.stringify(JSON.parse(fs.readFileSync(stateFile)))!==JSON.stringify(state)
    ||JSON.stringify(JSON.parse(fs.readFileSync(submissionFile)))!==JSON.stringify(intent))return false;
 return true;
}
function archiveAttempts(submissionFile){
 const suffix='.deleted-first-clip-'+Date.now();
 for(const extension of ['.missing.json','.safety-review.json']){
  const file=submissionFile+extension;if(fs.existsSync(file))fs.renameSync(file,file+suffix);
 }
}
module.exports={eligible,confirm,archiveAttempts};
