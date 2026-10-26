const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const review=require('../agent_blocked_followup');
const control=require('../agent_recovery_control');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-order-'));
try{
 const file=path.join(dir,'submission.json');fs.writeFileSync(file,JSON.stringify({from:1,to:5,fingerprint:'same-story'}));
 const snap={mediaTiles:{ready_video_tile:2,failed_video_tile:0,generating_video_tile:0,agent_busy:false,project_scan_complete:true},conversationRows:[{role:'agent',text:'This prompt might violate our policies about generating sexual content. Please try a different prompt.'}]};
 const plan=review.followupPlan(snap,file);
 assert(plan,'explicit refusal may have no corresponding grid tiles');
 assert(plan.text.includes('ONE substantive safety revision'));
 assert(plan.text.includes('only within the review limit'));
 review.mark(plan);assert.equal(review.followupPlan(snap,file),null,'one review across restarts');
 assert.throws(()=>control.assertRecoverable(snap),/FLOW_REVIEW_REQUIRED/,'after review, repeated refusal is terminal');
 assert.equal(review.followupPlan({...snap,mediaTiles:{...snap.mediaTiles,ready_video_tile:5}},file),null);
 const source=fs.readFileSync(require.resolve('../agent_mode'),'utf8');
 const pos=source.indexOf('if (RETRY_FAILED_ONLY &&');
 const end=source.indexOf('// Reconcile batches',pos);
 const block=source.slice(pos,end);
 assert(block.indexOf('reviewFailedBatch')<block.indexOf('assertRecoverable'));
 console.log('PASS: refused Agent request with only two completed grid clips gets one bounded review before terminal guard; completed clips and receipt remain unchanged.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
