const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const r=require('../agent_blocked_followup');
const {projectFrame}=require('../agent_project_media');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blocked-scene-review-'));
try{
 const file=path.join(dir,'submission.json');fs.writeFileSync(file,JSON.stringify({from:6,to:10,fingerprint:'fingerprint'}));
 const snapshot={mediaTiles:{ready_video_tile:2,failed_video_tile:3,generating_video_tile:0,agent_busy:false,project_scan_complete:true}};
 const plan=r.followupPlan(snapshot,file);assert(plan.text.includes('scenes 6-10'));assert(plan.text.includes('Preserve all successful clips'));
 assert(plan.text.includes('only within the review limit'));assert(plan.text.includes('ONE substantive safety revision'));
 for(const change of [{agent_busy:true},{generating_video_tile:1},{project_scan_complete:false},{failed_video_tile:0}])assert.equal(r.followupPlan({mediaTiles:{...snapshot.mediaTiles,...change}},file),null);
 r.mark(plan);assert.equal(r.followupPlan(snapshot,file),null,'process restart must not repeat review request');
 global.window={scrollY:0,scrollX:0};
 const tile={tagName:'FLOW-VIDEO-TILE',innerText:'This prompt might violate our policies. Try a different prompt.',getBoundingClientRect:()=>({x:0,y:0,height:180}),querySelectorAll:()=>[],querySelector:()=>null};
 global.document={querySelectorAll:()=>[tile],documentElement:{scrollHeight:500},body:{scrollHeight:500}};
 const observed=projectFrame().tiles[0];assert(observed.failed);assert(!observed.busy,'refusal without a video preview must never be a pending generation');
 delete global.window;delete global.document;
 console.log('PASS: settled failed batch sends one scene-scoped review; pending jobs cannot trigger it; saved receipt prevents repeats; policy cards are failed rather than endlessly generating.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
