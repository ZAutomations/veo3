const assert=require('assert'),fs=require('fs'),path=require('path');
const R=require('../ingredients_resume_start');
(async()=>{
 const url='https://flow.google.com/project/test';let editorCalls=0,waits=0;
 const page={url:()=>url,waitForSelector:async()=>{},evaluate:async()=>({videos:0,images:3,pending:false,stop:false,failed:false,ready:0,composer:true,loading:false})};
 const engine={opts:{resumeAuto:true},fromScene:1,skipRefs:true,page,projectUrl:url,browser:{pages:async()=>[page]},isEditorUrl:u=>u.includes('/edit/'),ensureEditor:async()=>{editorCalls++;},countCompletedClips:async()=>1};
 assert.equal(await R.prepare(engine),0);assert.equal(editorCalls,0);assert.equal(engine.skipRefs,false);assert.equal(engine.opts.autoStart,true);assert.equal(engine.opts.noUploadRefs,true);assert(engine._refsGenerated);
 let opened=false;const editor={url:()=>url+'/edit/clip-one'};engine.waitForEditorReady=async()=>{};engine.clickNewestClip=async()=>{editorCalls++;};engine.browser.pages=async()=>opened?[editor]:[page];
 const states=[{videos:1,images:3,pending:true,ready:0},{videos:1,images:3,pending:false,ready:1}];page.evaluate=async fn=>fn.name==='gridState'?states.shift():fn.name==='tileSnapshot'?[{assetId:'one',key:'key1',ready:true}]:fn.name==='clickTile'?(opened=true,true):null;
 assert.equal(await R.prepare(engine,{wait:async()=>{waits++;}}),1);assert.equal(waits,1);assert.equal(editorCalls,1);
 opened=false;engine.page=page;page.evaluate=async()=>({videos:1,images:3,failed:true,ready:0});await assert.rejects(()=>R.prepare(engine),/RECOVERY_REVIEW_REQUIRED/);assert.equal(editorCalls,1);
 assert.throws(()=>R.checkModel({videoModel:'Omni 1.1 Flash'}),/Select Veo 3.1/);R.checkModel({videoModel:'Veo 3.1 - Lite'});R.checkModel({videoModel:'Omni 1.1 Flash',refsOnly:true});
 const story={title:'A quiet cat story',heartwarming_cat:true,narrated:false,scenes:Array.from({length:8},()=>({start_state:'Cat sits beside the bed.',end_state:'Cat rests beside Girl.',shots:[{start_seconds:0,end_seconds:3,visual:'Cat nudges its teddy.'},{start_seconds:3,end_seconds:8,visual:'Girl gently strokes Cat.'}],sound_context:'Quiet piano, soft paws and purring.'}))};
 const derived=require('../extend_prompts').deriveExtendPrompts(story,8);assert(derived.ok,derived.reason);assert.equal(Object.keys(derived.prompts).length,7);for(const prompt of Object.values(derived.prompts)){assert(prompt.startsWith('Continue from the exact final frame'));assert(!prompt.includes('Generate ONE standalone'));assert(prompt.includes('Audio:'));assert(prompt.includes('No narration'));}
 const source=fs.readFileSync(path.join(__dirname,'../veo3_flow_new_ui.js'),'utf8');assert(source.includes("require('./ingredients_resume_start').prepare(this,{log})"));assert(source.includes('opts.resumeAuto=true;opts.autoStart=true;'));
 console.log('PASS: refs-only resume generates clip 1 before editor, pending clip is not resubmitted, failed clip stops, incompatible model is explicit, and seven native-audio continuation prompts derive from structured cat scenes. No browser generation used.');
})().catch(e=>{console.error(e);process.exitCode=1;});
