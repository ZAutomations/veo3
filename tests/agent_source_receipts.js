const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),R=require('../agent_source_receipts'),ids=require('../agent_scene_ids');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'veo-source-receipts-')),file=path.join(dir,'story.json'),project='https://flow.google.com/project/test-project';
try{
 const story={title:'Receipt regression',scenes:[{script_line:'First unique narration for this story'},{script_line:'Second unique narration for this story'}]};fs.writeFileSync(file,JSON.stringify(story));
 const tiles=[{assetId:'b',ready:true,assetTitle:ids.sceneId(story,2),text:'360p'},{assetId:'a',ready:true,assetTitle:'Generic generated caption',text:'360p'}];
 R.save(file,project,[{scene:1,assetId:'a',duration:10}]);assert.equal(R.plan(file,project,tiles),null,'partial receipt must not complete a story');
 R.save(file,project,[{scene:2,assetId:'b',duration:10}]);const plan=R.plan(file,project,tiles);assert.deepEqual(plan.map(e=>e.receipt.assetId),['a','b'],'receipt mapping must beat reversed grid and mixed names');
 assert.equal(R.plan(file,'https://flow.google.com/project/other',tiles),null);
 assert.throws(()=>R.plan(file,project,tiles.slice(0,1)),/absent or not unique/);
 assert.throws(()=>R.plan(file,project,[...tiles,tiles[1]]),/absent or not unique/);
 assert.throws(()=>R.plan(file,project,tiles.map(t=>({...t,assetTitle:ids.sceneId(story,2)}))),/conflicts/);
 assert.throws(()=>R.plan(file,project,tiles.map(t=>({...t,failed:true}))),/absent or not unique/);
 fs.writeFileSync(file,JSON.stringify({...story,title:'Changed story'}));assert.equal(R.plan(file,project,tiles),null,'edited story invalidates receipts');
 console.log('PASS: verified scene receipts survive missing titles and reversed grid; partial, changed-story, wrong-project, missing, duplicate, failed and conflicting assets cannot authorize downloads.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
