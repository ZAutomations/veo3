const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {runAgentBatches}=require('../agent_batches');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-size-'));
 try{
 const story=path.join(dir,'story.json');fs.writeFileSync(story,JSON.stringify({scenes:Array(20).fill({})}));
 const requests=[];
 const run=async(a,args)=>{if(typeof a==='string'){fs.writeFileSync(args[args.indexOf('--out')+1],'prompt');return {code:0};}requests.push([a._required_ready+1,a._expected]);return {ok:true,text:'done'};};
 const options={project_url:'https://flow.google.com/project/custom-eight',clip_batch_size:8};
 assert((await runAgentBatches(options,story,run,()=>{})).ok);
 assert.deepStrictEqual(requests,[[1,8],[9,16],[17,20]]);
 assert((await runAgentBatches(options,story,run,()=>{})).ok);assert.equal(requests.length,3);
 assert(!(await runAgentBatches({...options,clip_batch_size:1.5},story,run,()=>{})).ok);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 console.log('PASS: normal Agent driver uses 8/8/4, no seven-clip cap, completed checkpoints not replayed.');
})().catch(e=>{console.error(e);process.exitCode=1});
