const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {execFileSync}=require('child_process');
const {UpscaledDownloader}=require('../single_clip_omni_upscaled');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'omni-browser-download-test-'));
const fixture=path.join(folder,'fixture.mp4');
const fixture1080=path.join(folder,'fixture1080.mp4');
execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=black:s=1280x720:r=10','-t','0.2','-c:v','libx264','-preset','ultrafast',fixture],{windowsHide:true,timeout:30000});
execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=black:s=1920x1080:r=10','-t','0.2','-c:v','libx264','-preset','ultrafast',fixture1080],{windowsHide:true,timeout:30000});
let mode='',newPages=0,backgroundNavigations=0,menuClicks=0,downloads=0,downloadPath='',generationChecks=0,nativeOptions=false,captionsOnly=false,copiedPrompt='',recycledNumber=0,chosenOption='';
const original=n=>`Original prompt for scene ${n}: a woman notices a broken vase and thoughtfully considers what happened.`;
const callbacks={};
const cdp={on:(event,fn)=>callbacks[event]=fn,send:async(method,args)=>{if(args?.downloadPath)downloadPath=args.downloadPath;},detach:async()=>{}};
const page={bringToFront:async()=>{},goto:async()=>backgroundNavigations++,waitForSelector:async()=>{},close:async()=>{},
 waitForFunction:async()=>{},
 keyboard:{press:async()=>mode=''},
 evaluate:async(fn,args)=>{
  if(fn.name==='metrics')return {top:0,scroll:500,client:500};
  if(fn.name==='tileSnapshot')return (recycledNumber?[recycledNumber]:[1,2,3]).map(n=>({key:recycledNumber?'recycled-node':`tile-${n}`,assetId:captionsOnly?`changed-thumbnail-${n}`:`asset-${n}`,text:captionsOnly?'Generated short caption':`Prompt ${n}`,ready:true}));
  if(fn.name==='reuseForInspection'){copiedPrompt=original(recycledNumber||Number(args.key.split('-')[1]));return {previous:''};}
  if(!fn.name&&captionsOnly)return copiedPrompt;
  if(fn.name==='menuItems')return mode==='download'?[{text:'Download',x:30,y:40}]:mode==='sizes'?(nativeOptions?[{text:'720p Original',x:40,y:50},{text:'1080p Upscaled',x:50,y:60}]:[{text:'360p Original',x:40,y:50},{text:'720p Upscaled',x:50,y:60}]):[];
  if(fn.name==='openClipMenu'){mode='download';menuClicks++;return {ok:true,direct:false};}
  if(fn.name==='menuTarget'){chosenOption=args;return {x:50,y:60};}
  if(fn.name==='clickMenuText'){
   if(args==='Download')mode='sizes';
   return true;
  }
 },
 mouse:{move:async()=>{throw Error('unexpected mouse movement');},click:async(x,y)=>{assert.equal(x,50);assert.equal(y,60);assert.equal(mode,'sizes');const guid=`guid-${++downloads}`;fs.copyFileSync(chosenOption==='1080p Upscaled'?fixture1080:fixture,path.join(downloadPath,guid));callbacks['Browser.downloadWillBegin']({guid});callbacks['Browser.downloadProgress']({guid,state:'completed'});}}

};
const engine={projectUrl:'https://flow.google.com/project/test-pipeline',page:{bringToFront:async()=>{}},
 browser:{newPage:async()=>{newPages++;return page;},target:()=>({createCDPSession:async()=>cdp})}};
(async()=>{
 fs.mkdirSync(path.join(folder,'clips'));
 const prior='{"complete":true,"previous":"keep until finished"}';fs.writeFileSync(path.join(folder,'clips','manifest.json'),prior);
 fs.writeFileSync(path.join(folder,'clips','scene-02.mp4'),'old version');
 const d=new UpscaledDownloader(engine,{folder,total:3,storyHash:'same-story',checkGeneration:async()=>generationChecks++});
 await d.download({number:2,prompt:'Prompt 2'},{});
 assert.equal(fs.readFileSync(path.join(folder,'clips','manifest.json'),'utf8'),prior,'partial downloads must preserve the previous manifest');
 assert(fs.existsSync(path.join(folder,'clips','scene-02.mp4')));
 assert.equal(fs.readdirSync(path.join(folder,'clips','_replaced')).length,1);
 await d.download({number:2,prompt:'Prompt 2'},{});assert.equal(downloads,1,'verified upscaled file must be skipped');
 await d.group([{number:1,prompt:'Prompt 1'},{number:3,prompt:'Prompt 3'}],{});
 const manifest=JSON.parse(fs.readFileSync(path.join(folder,'clips','manifest.json'),'utf8'));
 assert(manifest.complete);assert.deepEqual(manifest.clips.map(c=>c.matched_scene),[1,2,3]);
 assert.equal(downloads,3);assert.equal(menuClicks,3);assert.equal(newPages,1);assert.equal(backgroundNavigations,1);
 assert(generationChecks>0);await d.close();
 const resumed=new UpscaledDownloader(engine,{folder,total:3,storyHash:'same-story'});
 await resumed.group([1,2,3].map(n=>({number:n,prompt:`Prompt ${n}`})),{});
 assert.equal(downloads,3);assert.equal(newPages,1,'resume must not even open a tab for verified downloads');
 nativeOptions=true;
 const native=new UpscaledDownloader(engine,{folder:path.join(folder,'native'),total:1,storyHash:'native-source',allowNative720:true,ledgerPrefix:'agent_upscaled'});
 const entry=await native.download({number:1,prompt:'Prompt 1'},{assetId:'asset-1',native720:true});
 assert.equal(entry.route,'native-720p');assert.equal(downloads,4);
 await native.download({number:1,prompt:'Prompt 1'},{assetId:'asset-1',native720:true});assert.equal(downloads,4);
 await assert.rejects(native.download({number:2,prompt:'Prompt 2'},{native720:false}),/Upscaled 720p/);
 await native.close();
 const upgraded=new UpscaledDownloader(engine,{folder:path.join(folder,'native'),total:1,storyHash:'native-source',upscaleFromSource:true,ledgerPrefix:'agent_upscaled'});
 const high=await upgraded.download({number:1,prompt:'Prompt 1'},{assetId:'asset-1',native720:true});
 assert.equal(high.route,'upscaled-1080p');assert.equal(high.width,1920);assert.equal(high.height,1080);assert.equal(downloads,5);
 await upgraded.download({number:1,prompt:'Prompt 1'},{assetId:'asset-1',native720:true});assert.equal(downloads,5,'verified 1080p must be skipped');
 assert(fs.existsSync(path.join(folder,'native','clips','_replaced')),'prior 720p file preserved during upgrade');
 await upgraded.close();
 nativeOptions=false;captionsOnly=true;
 const refreshed=new UpscaledDownloader(engine,{folder:path.join(folder,'refreshed'),total:1,storyHash:'caption-only'});
 const restored=await refreshed.download({number:1,prompt:original(1)},{assetId:'expired-thumbnail-token'});
 assert.equal(restored.assetId,'changed-thumbnail-1');assert.equal(restored.route,'upscaled-720p');assert.equal(downloads,6);
 await refreshed.download({number:1,prompt:original(1)},{assetId:'another-thumbnail-token'});assert.equal(downloads,6,'changing thumbnail tokens must not cause repeat downloads');
 await refreshed.close();
 recycledNumber=1;
 const recycled=new UpscaledDownloader(engine,{folder:path.join(folder,'recycled'),total:7,storyHash:'seven-clips'});
 await recycled.download({number:1,prompt:original(1)},{});
 recycledNumber=7; // Flow reuses the very same DOM node for the final clip.
 const seventh=await recycled.download({number:7,prompt:original(7)},{});
 assert.equal(seventh.scene,7);assert.equal(seventh.assetId,'changed-thumbnail-7');assert.equal(downloads,8);
 await recycled.close();
 nativeOptions=true;captionsOnly=false;recycledNumber=0;
 const originalDownloader=new UpscaledDownloader(engine,{folder:path.join(folder,'original'),total:1,storyHash:'original-source',downloadVersion:'original',targetResolution:720,ledgerPrefix:'omni_original'});
 const originalEntry=await originalDownloader.download({number:1,prompt:'Prompt 1'},{assetId:'asset-1'});
 assert.equal(originalEntry.route,'original-720p');assert.equal(downloads,9);
 await originalDownloader.download({number:1,prompt:'Prompt 1'},{assetId:'asset-1'});assert.equal(downloads,9,'verified Original must skip the second transfer');
 assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'original','clips','manifest.json'))).route,'Omni Original 720p');
 await originalDownloader.close();
 const assetDownloader=new UpscaledDownloader(engine,{folder:path.join(folder,'bulk-assets'),total:1,storyHash:'bulk-source',downloadVersion:'original',targetResolution:720,ledgerPrefix:'agent_original_assets',orderMode:'unresolved-assets'});
 const assetEntry=await assetDownloader.download({number:1,prompt:'AGENT ASSET ID: asset-1',scene:{}},{assetId:'asset-1',nativeResolution:720});
 assert(/^asset-[a-f0-9]{16}\.mp4$/.test(assetEntry.file));assert.equal(downloads,10);
 const unordered=JSON.parse(fs.readFileSync(path.join(folder,'bulk-assets','clips','manifest.json')));
 assert(!unordered.complete&&unordered.downloadComplete&&unordered.needsSceneOrdering);assert.equal(unordered.clips[0].matched_scene,null);assert.equal(unordered.clips[0].order_verified,false);
 await assetDownloader.download({number:1,prompt:'AGENT ASSET ID: asset-1',scene:{}},{assetId:'asset-1',nativeResolution:720});assert.equal(downloads,10,'verified asset collection must skip repeated downloads');
 await assetDownloader.close();
 const pagesBefore=newPages,navigationsBefore=backgroundNavigations;
 const borrowedEngine={...engine,page};
 const borrowed=new UpscaledDownloader(borrowedEngine,{folder:path.join(folder,'same-tab-assets'),total:1,storyHash:'same-tab',downloadVersion:'original',targetResolution:720,orderMode:'unresolved-assets',useExistingPage:true});
 const borrowedEntry=await borrowed.download({number:1,prompt:'AGENT ASSET ID: asset-1',scene:{}},{assetId:'asset-1',nativeResolution:720});
 assert(borrowedEntry.file.startsWith('asset-'));assert.equal(newPages,pagesBefore);assert.equal(backgroundNavigations,navigationsBefore,'completed Agent collection never opens or navigates another tab');
 let closed=false;const previousClose=page.close;page.close=async()=>closed=true;await borrowed.close();page.close=previousClose;
 assert(!closed,'borrowed project tab must remain open');
 console.log('PASS: scoped Upscaled menu clicks, CDP completion, real saved 720p files, skip on resume, scene-order manifest, no partial overwrite, one background tab.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(folder,{recursive:true,force:true}));
