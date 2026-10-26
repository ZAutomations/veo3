const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const r=require('../agent_missing_scenes');
(async()=>{
 const story={scenes:Array.from({length:5},(_,i)=>({script_line:`This is a sufficiently distinct narration for story scene number ${i+1} with unique content ${i+1}.`}))};
 const intent={from:1,to:5};
 const tiles=[0,3].map(i=>({text:story.scenes[i].script_line,ready:true,assetId:'asset'+i}));
 const result={exhaustive:true,generatingSeen:false,unidentifiedSources:false,tiles};
 assert.deepEqual(r.planMissing(story,intent,result),{completed:[1,4],missing:[2,3,5]});
 const complete={exhaustive:false,targetsVerified:true,generatingSeen:false,unidentifiedSources:false,tiles:story.scenes.map((scene,i)=>({text:scene.script_line,ready:true,assetId:`complete-${i}`}))};
 assert.deepEqual(r.planMissing(story,intent,complete),{completed:[1,2,3,4,5],missing:[]},'verified target scenes need not scan unrelated older assets to prove no retry is needed');
 for(const bad of [{exhaustive:false},{generatingSeen:true},{unidentifiedSources:true},{tiles:[{...tiles[0],text:'unknown'}]},{tiles:[{...tiles[0],ready:false}]}])assert.throws(()=>r.planMissing(story,intent,{...result,...bad}));
 const withRetryCopy={...result,tiles:[...tiles,{...tiles[0],assetId:'retry-copy'}]};assert.deepEqual(r.planMissing(story,intent,withRetryCopy),{completed:[1,4],missing:[2,3,5]},'a retry copy of an already-complete scene does not change missing-scene selection');
 const failedOnly={...result,tiles:[...tiles,{text:story.scenes[1].script_line,ready:false,failed:true,assetId:'failed-scene-2'}]};assert.deepEqual(r.planMissing(story,intent,failedOnly),{completed:[1,4],missing:[2,3,5]},'failed attempt remains missing unless a ready copy exists');
 const text='Create exactly 5 separate clips for scenes 1-5, one clip per scene.\nSettings and @Environment\n'+story.scenes.map((s,i)=>`Scene ${i+1} \u2014 Clip ${i+1}\n${s.script_line}\n`).join('\n');
 const prompt=r.missingPrompt(text,[2,3,5]);
 assert(!prompt.includes('Create exactly 5'));assert(!prompt.includes('Scene 1 '));assert(!prompt.includes('Scene 4 '));
 for(const n of [2,3,5])assert(prompt.includes(`Scene ${n} `));assert(prompt.includes('@Environment'));
 const driver=fs.readFileSync(require.resolve('../agent_mode'),'utf8');assert(driver.includes('MANDATORY RETRY PREFLIGHT'));assert(driver.includes('Generate only the exact missing or failed scene numbers'));
 const recoveryFn=driver.slice(driver.indexOf('async function reviewFailedBatch'),driver.indexOf('async function retryFailedMediaOnly'));
 assert(recoveryFn.includes('const browser=page.browser()'),'module-scoped retry review must obtain its browser from the attached page');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'agent-missing-'));
 try{
  const storyFile=path.join(folder,'story.json'),submissionFile=path.join(folder,'submission.json');
  const source=JSON.stringify(story);fs.writeFileSync(storyFile,source);fs.writeFileSync(submissionFile,JSON.stringify({...intent,fingerprint:crypto.createHash('sha256').update(source).digest('hex')}));
  let reads=0;const opts={storyFile,submissionFile,text,engine:{},wait:async()=>{},inspect:async()=>{reads++;return result;}};
  const plan=await r.prepare(opts);assert.equal(reads,2);r.markSubmitting(plan);
  await assert.rejects(r.prepare(opts),/unconfirmed/);
  const changed={...result,tiles:[...tiles,{text:story.scenes[1].script_line,ready:true,assetId:'new'}]};let n=0;
  await assert.rejects(r.prepare({...opts,inspect:async()=>++n===1?result:changed}),/changed/);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
 console.log('PASS: preserves two successes, selects only three missing scenes; refuses partial scans, ambiguity, active jobs and uncertain duplicate submissions; confirms inventory twice.');
})().catch(e=>{console.error(e);process.exitCode=1;});
