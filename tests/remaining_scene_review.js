const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const r=require('../agent_blocked_followup');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'remaining-review-'));
try{
 const file=path.join(dir,'submission.json');fs.writeFileSync(file,JSON.stringify({from:1,to:5,fingerprint:'same'}));
 const state=(ready,failed)=>({mediaTiles:{ready_video_tile:ready,failed_video_tile:failed,generating_video_tile:0,agent_busy:false,project_scan_complete:true}});
 const first=r.followupPlan(state(2,3),file);r.mark(first);
 assert.equal(r.followupPlan(state(2,3),file),null,'no repeated review without progress');
 const last=r.followupPlan(state(4,1),file);assert(last&&last.reviewNumber===2);
 assert(last.text.includes('Exactly 1 scene(s) remain incomplete'));assert(last.text.includes('ONE final substantive safety revision'));r.mark(last);
 assert.equal(r.followupPlan(state(4,1),file),null,'no third review');
 fs.writeFileSync(file+'.safety-review.json',JSON.stringify({status:'submitting',from:1,to:5,fingerprint:'same',at:'2026-10-23T01:18:42Z'}));
 fs.writeFileSync(file+'.missing.json',JSON.stringify({numbers:[1,3,4],at:'2026-10-23T00:56:15Z'}));
 assert.equal(r.followupPlan(state(4,1),file).reviewNumber,2,'legacy receipt derives verified baseline from saved missing selection');
 console.log('PASS: 2/5 to 4/5 progress allows one final failed-scene-only revision; no-progress and third reviews blocked; legacy receipt supported.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
