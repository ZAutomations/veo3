function latestRefusal(snapshot){
 const rows=snapshot.conversationRows||[];
 const last=rows.at(-1);
 if(!last||last.role!=='agent')return '';
 const text=String(last.text||'').replace(/^\s*(?:warning|error|failed)\s*/i,'').trim();
 const direct=/^(?:this prompt (?:might|may) violate|i (?:cannot|can't|am unable to) (?:generate|create|help)|(?:cannot|can't|unable to) generate|the prompt (?:was|is) (?:blocked|rejected))/i.test(text);
 return direct&&/polic|sexual content|safety|third.party|rights|prohibited/i.test(text)?text.slice(0,650):'';
}
function assertRecoverable(snapshot){
 const refusal=latestRefusal(snapshot);
 if(refusal)throw Error('FLOW_REVIEW_REQUIRED: Flow explicitly refused the latest request: '+refusal+' Automatic retries stopped; revise the story to an allowed treatment or choose another story. Completed clips are preserved.');
}
module.exports={latestRefusal,assertRecoverable};
