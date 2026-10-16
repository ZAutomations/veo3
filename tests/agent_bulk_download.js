const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {assetPlan,plan}=require('../agent_upscaled_download');
const {UpscaledDownloader,videoInfo}=require('../single_clip_omni_upscaled');
const {locateJob}=require('../single_clip_omni_media');
const {execFileSync}=require('child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-bulk-download-'));
try{
 const story={scenes:[1,2,3].map(n=>({script_line:`This is the completely unique narration passage belonging to scene number ${n}.`}))};
 const file=path.join(dir,'test_story.json');fs.writeFileSync(file,JSON.stringify(story));
 const project='https://flow.google.com/project/p';
 const checkpoint={project:'p',fingerprint:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),total:3,completed:3,pending:null};
 fs.writeFileSync(path.join(dir,'agent_batches_p.json'),JSON.stringify(checkpoint));
 const shared=story.scenes.map(s=>s.script_line).join('\n');
 const tiles=[{assetId:'c',text:shared+'\n360p',ready:true},{assetId:'a',text:shared+'\n360p',ready:true},{assetId:'b',text:shared+'\n360p',ready:true}];
 assert.throws(()=>plan(tiles,story),/multiple matching/);
 const entries=assetPlan(tiles,story,file,project);assert.equal(entries.length,3);assert.deepEqual(entries.map(e=>e.receipt.assetId),['a','b','c']);
 assert.equal(entries[0].receipt.nativeResolution,360);
 assert.equal(assetPlan(tiles.slice(1),story,file,project),null);
 assert.equal(assetPlan([...tiles.slice(0,2),tiles[0]],story,file,project),null);
 assert.equal(assetPlan(tiles.map((t,i)=>({...t,busy:i===0})),story,file,project),null);
 const hit={assetId:'video-source',assetIds:['video-source','thumbnail-source'],ready:true,text:'caption'};
 assert.equal(locateJob([hit],{number:1,prompt:'unknown'}, {assetId:'thumbnail-source'}),hit);
 const d=new UpscaledDownloader({projectUrl:project},{folder:dir,total:3,storyHash:'same',orderMode:'unresolved-assets',downloadVersion:'original',targetResolution:360});
 fs.mkdirSync(d.out,{recursive:true});
 const fixture=path.join(dir,'fixture.mp4');execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=size=360x640:rate=10:duration=0.2','-c:v','libx264','-preset','ultrafast',fixture],{windowsHide:true});
 const info=videoInfo(fixture,360);
 for(let n=1;n<=3;n++){const name=`asset-${n}.mp4`;fs.copyFileSync(fixture,path.join(d.out,name));d.ledger.clips.push({scene:n,file:name,assetId:entries[n-1].receipt.assetId,route:'original-360p',width:info.width,height:info.height,sha256:info.sha256});d.targets.set(n,360);}
 d.save();
 const manifest=JSON.parse(fs.readFileSync(path.join(d.out,'manifest.json'),'utf8'));
 assert(!manifest.complete&&manifest.downloadComplete&&manifest.needsSceneOrdering);assert.equal(manifest.orderResolvedBy,null);
 assert(manifest.clips.every(c=>c.matched_scene===null&&c.order_verified===false));
 assert.equal(require('../mcp_server').downloadedClipCount(d.out),3,'pipeline recognises asset-named downloads through their manifest');
 const blocked=require('child_process').spawnSync(process.execPath,[path.join(__dirname,'../join_clips.js'),d.out,'--dry-run','--reverse'],{encoding:'utf8'});
 assert.equal(blocked.status,2);assert((blocked.stdout+blocked.stderr).includes('REFUSING TO JOIN'));
 const before=fs.readFileSync(file,'utf8');fs.appendFileSync(file,' ');assert.equal(assetPlan(tiles,story,file,project),null);fs.writeFileSync(file,before);
 checkpoint.completed=2;fs.writeFileSync(path.join(dir,'agent_batches_p.json'),JSON.stringify(checkpoint));assert.equal(assetPlan(tiles,story,file,project),null);
 console.log('PASS: shared batch prompts cannot assign scene order; matching completed checkpoint enables unique-asset collection; manifest requires narration resolution; incomplete/changed projects blocked.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
