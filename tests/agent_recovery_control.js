const assert=require('assert');
const r=require('../agent_recovery_control');
const inspect=require('../single_clip_omni_recovery').inspectProject;
(async()=>{
 const refusal={role:'agent',text:'This prompt might violate our policies about generating sexual content. Please try a different prompt.'};
 assert.throws(()=>r.assertRecoverable({conversationRows:[refusal]}),/FLOW_REVIEW_REQUIRED/);
 assert.doesNotThrow(()=>r.assertRecoverable({conversationRows:[refusal,{role:'user',text:'New permitted request'},{role:'agent',text:'I have initiated generation for scene 3.'}]}));
 assert.doesNotThrow(()=>r.assertRecoverable({conversationRows:[{role:'user',text:refusal.text}]}));
 const jobs=[1,2,3].map(n=>({number:n,prompt:`This unique narration identifies scene number ${n} with enough detail to match the exact source.`,scene:{}}));
 let reads=0,reuses=0,closed=0,gotos=0,copied='';
 const page={goto:async()=>{gotos++;},close:async()=>{closed++;},bringToFront:async()=>{},waitForSelector:async()=>{},waitForFunction:async()=>{},evaluate:async(fn,arg)=>{
  if(fn.name==='metrics')return {top:0,client:600,scroll:600,visible:true};
  if(fn.name==='tileSnapshot'){reads++;return [1,2].map(n=>({key:'key'+n,assetId:'asset'+n,text:'generated caption',ready:true}));}
  if(fn.name==='reuseForInspection'){reuses++;copied=jobs[Number(arg.assetId.slice(5))-1].prompt;return {previous:'old'};}
  if(!fn.name)return copied;
 }};
 const engine={browser:{newPage:async()=>{throw Error('must not open a new tab');}},page,projectUrl:'https://flow.google.com/project/same'};
 const sourceCache=new Map();
 for(let pass=0;pass<2;pass++){
  const result=await inspect(engine,jobs,{}, {page,sourceCache,sleep:async()=>{}});
  assert(result.exhaustive&&!result.unidentifiedSources);assert(result.found[1]&&result.found[2]);
 }
 assert.equal(gotos,0);assert.equal(closed,0);assert.equal(reuses,2,'cached source prompts survive both full confirmations');assert(reads>2);
 console.log('PASS: two exhaustive checks use current tab, no navigation/new tabs, source reads cached; latest explicit refusal stops recovery, historical refusal cannot block a new accepted request.');
})().catch(e=>{console.error(e);process.exitCode=1;});
