const assert=require('assert'),fs=require('fs'),path=require('path');
const F=require('../ingredients_first_clip');
(async()=>{
 const old={assetId:'old',ready:true},fresh={assetId:'new',key:'new-key',ready:true,busy:false};
 assert.equal(F.newlyCompleted([old,fresh],[old]),fresh,'completed preview is sufficient even if Stop was never observed');
 assert.equal(F.newlyCompleted([old,{...fresh,ready:false,busy:true}],[old]),null);
 assert.equal(F.newlyCompleted([old],[old]),null,'never select a preexisting completed asset');
 assert.throws(()=>F.newlyCompleted([fresh,{...fresh,assetId:'another'}],[]),/Multiple new/);
 assert.throws(()=>F.newlyCompleted([{...fresh,failed:true}],[]),/RECOVERY_REVIEW_REQUIRED/);
 let selected=null,clicks=0,ready=0;
 const url='https://flow.google.com/project/test',editor={url:()=>url+'/edit/new'};
 const engine={projectUrl:url,page:{evaluate:async(fn,t)=>{selected=t;clicks++;return true;}},browser:{pages:async()=>[editor]},isEditorUrl:u=>u.includes('/edit/'),waitForEditorReady:async()=>{ready++;},clickNewestClip:async()=>{}};
 await F.openCompleted(engine,fresh);assert.equal(selected.assetId,'new');assert.equal(clicks,1);assert.equal(ready,1);assert.equal(engine.page,editor);
 const source=fs.readFileSync(path.join(__dirname,'../veo3_flow_new_ui.js'),'utf8');assert(source.includes('newlyCompleted(completedFirst,firstClipBefore)'));assert(!source.includes('if (sawGenerating || this.isEditorUrl(st.url))'));
 console.log('PASS: first clip completion uses the new asset preview without requiring a Stop button; pending/old/ambiguous clips cannot be opened; editor targets confirmed asset.');
})().catch(e=>{console.error(e);process.exitCode=1;});
