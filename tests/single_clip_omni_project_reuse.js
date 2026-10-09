const assert=require('assert');
const {reuseProjectTab}=require('../single_clip_omni_backlog');
(async()=>{
 let navigations=0,hardens=0;
 const target='https://flow.google.com/project/wanted';
 const wanted={url:()=>target,goto:async()=>navigations++};
 const other={url:()=> 'https://flow.google.com/project/other',goto:async()=>navigations++};
 const engine={projectUrl:target,page:other,browser:{pages:async()=>[other,wanted]},hardenPage:async()=>hardens++};
 await reuseProjectTab(engine);assert.equal(engine.page,wanted);assert.equal(navigations,0);assert.equal(hardens,1);
 await reuseProjectTab(engine);assert.equal(navigations,0);assert.equal(hardens,1);
 engine.projectUrl='https://flow.google.com/project/not-open';await reuseProjectTab(engine);assert.equal(navigations,1);
 console.log('PASS: already-open requested project is reused without navigation; unopened project navigates once.');
})().catch(e=>{console.error(e);process.exitCode=1;});
