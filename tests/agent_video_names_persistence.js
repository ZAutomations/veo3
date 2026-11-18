const assert=require('assert'),N=require('../agent_video_names');
(async()=>{
const planned=[{sceneId:'V3_aaaaaaaaaaaa_S001'}];let loads=0,closed=false;
const probe={goto:async()=>{loads++},waitForSelector:async()=>{},evaluate:async fn=>fn.name==='metrics'?{top:0,scroll:100,client:100}:null,close:async()=>{closed=true}};
const page={url:()=> 'https://flow.google.com/project/test',browser:()=>({newPage:async()=>probe})};
const good={assetId:'rotated-signed-id',assetTitle:planned[0].sceneId,ready:true};
assert(!N.persistedTitles([good,{...good,assetId:'duplicate'}],planned));
assert(!N.persistedTitles([{...good,busy:true}],planned));
await N.verifyPersisted(page,planned,{sleep:async()=>{},snapshot:async()=>loads<2?[{...good,assetTitle:'Generic'}]:[good]});
assert.equal(loads,2);assert(closed,'independent tab must close');
loads=0;closed=false;
await assert.rejects(N.verifyPersisted(page,planned,{attempts:2,sleep:async()=>{},snapshot:async()=>[{...good,assetTitle:'Generic'}]}),/did not persist/);
assert.equal(loads,2);assert(closed);
console.log('PASS: optimistic local names cannot authorize persistence; delayed remote save retried, duplicate/busy titles rejected, independent tab cleaned up.');
})().catch(e=>{console.error(e);process.exitCode=1});
