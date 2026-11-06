const DIRECT_REFUSAL=/\b(?:this prompt (?:might|may|could) violate|prompt (?:might|may) violate|policies? about generating|(?:content|safety) polic(?:y|ies) (?:does not|doesn't|do not|don't) allow|(?:cannot|can't|unable to) (?:generate|create|help with)|(?:was|is) (?:blocked|rejected) (?:by|for) (?:our )?(?:policy|policies|safety)|violates? (?:our )?(?:policy|policies|guidelines)|not allowed under (?:our )?(?:policy|policies)|against our (?:policy|policies|guidelines)|reputational risk|misrepresent(?:ing|ation of)? current events|third.party content providers)/i;
function refusalText(value){
 const text=String(value||'').replace(/^\s*(?:warning|error|failed)\s*/i,'').trim();
 return DIRECT_REFUSAL.test(text)?text.slice(0,650):'';
}
function latestRefusal(snapshot){
 // Prefer the latest explicit Agent response. An accepted follow-up from the
 // Agent supersedes an older refusal in the same conversation.
 const rows=snapshot.conversationRows||[];
 const latestAgent=[...rows].reverse().find(row=>row.role==='agent');
 const rowRefusal=latestAgent?refusalText(latestAgent.text):'';
 if(rowRefusal)return rowRefusal;

 // Flow sometimes renders a policy rejection as a media/error card outside
 // the conversation row selectors. These are collected separately by the
 // page snapshot and full project scan.
 const candidates=[
  ...(Array.isArray(snapshot.policyRefusals)?snapshot.policyRefusals:[]),
  ...(Array.isArray(snapshot.mediaTiles?.failed_policy_texts)?snapshot.mediaTiles.failed_policy_texts:[]),
 ];
 for(const item of candidates){const found=refusalText(typeof item==='string'?item:item?.text);if(found)return found;}
 return '';
}
function actionableRefusal(snapshot,submissionFile){
 const refusal=latestRefusal(snapshot);if(!refusal)return '';
 if(!submissionFile)return refusal;
 let receipt;try{receipt=JSON.parse(require('fs').readFileSync(submissionFile+'.missing.json','utf8'));}catch{}
 if(!['submitting','confirmed'].includes(receipt?.status))return refusal;
 // The old refusal card can remain on screen while Flow is processing the
 // single approved revision. Ignore it until a new Agent response or a newly
 // failed video proves the revised request itself was rejected.
 const rows=snapshot.conversationRows||[],agents=rows.filter(row=>row.role==='agent');
 const newAgents=agents.slice(Number(receipt.priorAgentCount)||0);
 if(newAgents.some(row=>refusalText(row.text)))return refusal;
 const priorFailed=Number(receipt.priorFailedVideos)||0;
 if(Number(snapshot.mediaTiles?.failed_video_tile||0)>priorFailed)return refusal;
 const currentPolicy=Array.isArray(snapshot.mediaTiles?.failed_policy_texts)?snapshot.mediaTiles.failed_policy_texts.length:0;
 if(currentPolicy>Number(receipt.priorPolicyCount||0))return refusal;
 const visiblePolicy=Array.isArray(snapshot.policyRefusals)?snapshot.policyRefusals.length:0;
 if(visiblePolicy>Number(receipt.priorVisibleRefusalCount||0))return refusal;
 return '';
}
function assertRecoverable(snapshot,submissionFile){
 const refusal=actionableRefusal(snapshot,submissionFile);
 if(refusal)throw Error('FLOW_REVIEW_REQUIRED: Flow explicitly refused the latest request: '+refusal+' Automatic retries stopped; revise the story to an allowed treatment or choose another story. Completed clips are preserved.');
}
module.exports={latestRefusal,actionableRefusal,assertRecoverable,refusalText};
