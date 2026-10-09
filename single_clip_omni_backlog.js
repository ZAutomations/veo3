const fs=require('fs'),path=require('path'),crypto=require('crypto');
function fingerprint(jobs,request,refs){return crypto.createHash('sha256').update(JSON.stringify({jobs:jobs.map(j=>[j.number,j.prompt]),model:request.model,ratio:request.aspect,resolution:request.resolution,refs:refs.map(r=>[r.name,r.localFile||r.file])})).digest('hex');}
function collect(folder,project,jobs,request,refs){
 const prefix=`single_clip_omni_${project.split('/project/')[1]}_`,completed=new Set(),submitted=new Set(),receipts={};
 for(const file of fs.readdirSync(folder).filter(f=>f.startsWith(prefix)&&/^.*_\d+_\d+\.json$/.test(f))){
  const range=file.match(/_(\d+)_(\d+)\.json$/);let state;
  try{state=JSON.parse(fs.readFileSync(path.join(folder,file),'utf8'));}catch{continue;}
  const rangeJobs=jobs.slice(Number(range[1])-1,Number(range[2]));
  if(state.project!==project||state.hash!==fingerprint(rangeJobs,request,refs))continue;
  for(const n of state.completed||[])completed.add(n);
  for(const n of state.projectCompleted||[])completed.add(n);
  for(const n of state.submitted||[])submitted.add(n);
  if(state.submitting)submitted.add(state.submitting);
  Object.assign(receipts,state.receipts||{});
 }
 return {completed:[...completed],submitted:[...submitted],receipts};
}
async function reuseProjectTab(engine){
 const pages=await engine.browser.pages();
 const exact=pages.find(p=>p.url().replace(/\/$/,'')===engine.projectUrl);
 if(exact&&exact!==engine.page){engine.page=exact;await engine.hardenPage();}
 if(engine.page.url().replace(/\/$/,'')!==engine.projectUrl)await engine.page.goto(engine.projectUrl,{waitUntil:'domcontentloaded',timeout:120000});
}
module.exports={fingerprint,collect,reuseProjectTab};
