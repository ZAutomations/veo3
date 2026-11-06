const assert=require('assert');
const recovery=require('../agent_recovery_control');
const fs=require('fs'),os=require('os'),path=require('path');
const {projectFrame}=require('../agent_project_media');
const mode=fs.readFileSync(require.resolve('../agent_mode'),'utf8');

const explicit='This prompt might violate our policies about generating prominent people. Please try a different prompt.';
assert.match(recovery.latestRefusal({conversationRows:[],policyRefusals:[explicit]}),/prominent people/i,
  'standalone visible refusal card must be detected without conversation rows');
assert.match(recovery.latestRefusal({mediaTiles:{failed_policy_texts:[explicit]}}),/might violate/i,
  'full project scan refusal text must be detected');
assert.match(recovery.latestRefusal({conversationRows:[{role:'agent',text:explicit},{role:'user',text:'retry'}]}),/might violate/i,
  'a user row after the refusal must not hide the latest agent refusal');
assert.equal(recovery.latestRefusal({conversationRows:[{role:'agent',text:explicit},{role:'agent',text:'I have resubmitted scene 4 and generation is queued.'}]}),'',
  'a newer successful Agent response supersedes old refusal text');
assert.equal(recovery.latestRefusal({conversationRows:[{role:'user',text:explicit}]}),'',
  'user-provided text must not be mistaken for a provider refusal');
assert.equal(recovery.latestRefusal({policyRefusals:['The story discusses policy changes in history.']}),'',
  'ordinary policy discussion must not trigger recovery');

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'policy-receipt-'));
try{
 const submission=path.join(tmp,'batch.submission.json');fs.writeFileSync(submission,'{}');
 fs.writeFileSync(submission+'.missing.json',JSON.stringify({status:'submitting',priorAgentCount:1,priorFailedVideos:0,priorPolicyCount:0}));
 const old={mediaTiles:{failed_video_tile:0},conversationRows:[{role:'agent',text:explicit}]};
 assert.equal(recovery.actionableRefusal(old,submission),'','old refusal stays suppressed while the revision is pending');
 assert.match(recovery.actionableRefusal({...old,conversationRows:[...old.conversationRows,{role:'agent',text:explicit}]},submission),/might violate/i,
   'a fresh Agent refusal after the submitted revision is actionable');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

global.window={};
const refusalTile={tagName:'FLOW-VIDEO-TILE',innerText:explicit,textContent:explicit,
 getBoundingClientRect:()=>({x:0,y:0,width:200,height:180}),querySelectorAll:()=>[],querySelector:()=>null};
global.document={querySelectorAll:s=>s==='flow-video-tile, flow-image-tile'?[refusalTile]:[],documentElement:{scrollHeight:500},body:{scrollHeight:500}};
const scanned=projectFrame().tiles[0];assert(scanned.failed&&scanned.policyFailure);assert.match(scanned.failureText,/prominent people/i);
for(const message of [
 'Unable to generate videos that might cause reputational risk or misrepresent current events. Please try a different prompt or send feedback.',
 'This request risks misrepresenting current events.',
 'Generation declined due to reputational risk.'
]){
 assert(recovery.latestRefusal({policyRefusals:[message]}),'visible current-events refusal must reach recovery');
 refusalTile.innerText=refusalTile.textContent=message;
 const tile=projectFrame().tiles[0];assert(tile.failed&&tile.policyFailure,'project inventory must classify the refusal as failed policy media, not an active generation');
}
assert.equal(recovery.latestRefusal({policyRefusals:['A documentary explains current events and institutional roles.']}),'');
const instructions=require('../agent_policy_recovery');
assert(instructions.includes('CURRENT EVENTS / REPUTATIONAL RISK'));
assert(instructions.includes('certified results'));
assert(instructions.includes('stop for review if refused again'));
delete global.window;delete global.document;

const start=mode.indexOf('async function retryFailedMediaOnly');
const end=mode.indexOf('// ---- deep read',start);
const retry=mode.slice(start,end);
assert(retry.indexOf('if (st.refusedText || require(\'./agent_recovery_control\').latestRefusal(cur))')
  < retry.indexOf('if (!st.retryButtons && !st.reuseInError)'),
  'policy refusals must be handled before the no-media-retry-control exit');
assert(retry.includes('while other clips are active'),
  'policy recovery waits for other submitted clips to settle');
assert(retry.indexOf('pendingSubmission')<retry.indexOf('clickFailures(page)'),
  'an unconfirmed scene-review submission must not trigger the stale failed-tile retry');
assert(mode.includes("[class*=message-row]"),
  'snapshot must read current Flow message rows beyond the old narrow selector');

console.log('PASS: standalone/prominent-person policy refusals are detected, accepted follow-ups clear stale refusals, and the retry path audits before checking tile retry buttons.');
