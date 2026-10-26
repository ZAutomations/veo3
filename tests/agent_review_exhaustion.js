const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const review=require('../agent_blocked_followup');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'review-scope-'));
try{
 const file=path.join(folder,'submission.json');
 fs.writeFileSync(file,JSON.stringify({from:1,to:5,fingerprint:'same'}));
 const snap={mediaTiles:{ready_video_tile:4,failed_video_tile:1,generating_video_tile:0,agent_busy:false,project_scan_complete:true}};
 review.mark(review.followupPlan(snap,file));assert(review.reviewWasSubmitted(file));assert.equal(review.followupPlan(snap,file),null);
 fs.writeFileSync(file,JSON.stringify({from:6,to:8,fingerprint:'same'}));
 assert(!review.reviewWasSubmitted(file),'an earlier batch must not exhaust a later batch review');
 const next=review.followupPlan({...snap,mediaTiles:{...snap.mediaTiles,ready_video_tile:7}},file);
 assert(next&&next.from===6&&next.to===8);review.mark(next);assert(review.reviewWasSubmitted(file));
 const code=fs.readFileSync(require.resolve('../agent_mode'),'utf8');assert(code.includes('A clip remains policy-blocked after the recorded safety review'));
 console.log('PASS: repeated policy refusal is terminal after recorded review; next batch has its own review allowance; successful clips never resubmitted.');
}finally{fs.rmSync(folder,{recursive:true,force:true});}
