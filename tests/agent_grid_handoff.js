const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {installGridScroller,gridMetrics}=require('../flow_grid_scroll');
const {projectFrame,projectMonitor}=require('../agent_project_media');
const {runAgentBatches}=require('../agent_batches');
(async()=>{
 const host={scrollTop:0,scrollLeft:0,clientHeight:674,scrollHeight:1231,tagName:'DIV',className:'grid',getBoundingClientRect:()=>({x:0,y:0})};
 let extentHeight=605;
 const spacer={getBoundingClientRect:()=>({y:76,height:extentHeight})};
 const tiles=Array.from({length:9},(_,i)=>({tagName:i<7?'FLOW-VIDEO-TILE':'FLOW-IMAGE-TILE',textContent:'play_circle',innerText:'play_circle',parentElement:null,
  getBoundingClientRect:()=>({x:i<7?i*180:0,y:i<7?76:387,bottom:i<7?371:681,height:i<7?295:294}),
  querySelectorAll:()=>[],querySelector:s=>s.includes('thumbnail')?{}:null,closest:()=>viewport}));
 const viewport={querySelector:()=>spacer,querySelectorAll:()=>tiles};
 global.window={scrollY:0,scrollX:0};global.document={querySelector:()=>tiles[0],querySelectorAll:()=>tiles,documentElement:{scrollHeight:1231},body:{scrollHeight:1231}};
 installGridScroller();window.__veoGridScroller=()=>host;
 assert.equal(gridMetrics().mediaCovered,true);
 assert.equal(gridMetrics().mediaEnd,681);
 assert.equal(projectFrame().tiles.filter(t=>t.video&&!t.busy).length,7,'completed preview without video src is ready');
 extentHeight=3000;assert.equal(gridMetrics().mediaCovered,false,'virtualized older rows cannot be skipped');
 let scans=0,time=0;const frame={mediaCovered:false,tiles:[]};
 const page={evaluate:async fn=>fn===projectFrame?frame:undefined};
 const monitor=projectMonitor(async()=>{scans++;return {flow_video_tile:5,ready_video_tile:5,failed_video_tile:0,generating_video_tile:0,project_scan_complete:true};},()=>time);
 await monitor(page);await monitor(page);time=4000;assert.equal((await monitor(page)).project_scan_complete,false);assert.equal(scans,1);
 time=30000;await monitor(page);assert.equal(scans,2);await monitor(page,true);assert.equal(scans,3);
 delete global.window;delete global.document;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-handoff-'));
 try{
  const story=path.join(dir,'story.json');fs.writeFileSync(story,JSON.stringify({scenes:Array.from({length:12},()=>({})),aspect_ratio:'9:16'}));
  const a={project_url:'https://flow.google.com/project/test-handoff',clip_batch_size:5,aspect:'9:16'};
  const requests=[];let fail=true;
  const run=async(arg,args)=>{
   if(typeof arg==='string'){fs.writeFileSync(args[args.indexOf('--out')+1],'prepared prompt');return {code:0};}
   requests.push([arg._required_ready,arg._expected,arg._retry_only]);
   if(!arg._retry_only){const intent=JSON.parse(fs.readFileSync(arg._submission_file));intent.status='submitting';fs.writeFileSync(arg._submission_file,JSON.stringify(intent));}
   if(arg._expected===10&&fail){fail=false;return {ok:false,text:'interrupted'};}
   return {ok:true,text:'completed'};
  };
  assert.equal((await runAgentBatches(a,story,run,()=>{})).ok,false);
  assert.equal((await runAgentBatches(a,story,run,()=>{})).ok,true);
  assert.deepEqual(requests,[[0,5,false],[5,10,false],[5,10,true],[10,12,false]],'resume checks pending second batch; first batch never resubmitted; tail follows');
  requests.length=0;assert.equal((await runAgentBatches(a,story,run,()=>{})).ok,true);assert.equal(requests.length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 console.log('PASS: real CDK media extent excludes empty tail; buffering preview ready; scans throttled; 5/5/2 handoff and interrupted retry preserve completed batches.');
})().catch(e=>{console.error(e);process.exitCode=1;});
