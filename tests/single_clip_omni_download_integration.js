const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {execFileSync}=require('child_process');
const {UpscaledDownloader}=require('../single_clip_omni_upscaled');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'omni-browser-download-test-'));
const fixture=path.join(folder,'fixture.mp4');
execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=black:s=1280x720:r=10','-t','0.2','-c:v','libx264','-preset','ultrafast',fixture],{windowsHide:true,timeout:30000});
let mode='',newPages=0,backgroundNavigations=0,menuClicks=0,downloads=0,downloadPath='',generationChecks=0,nativeOptions=false;
const callbacks={};
const cdp={on:(event,fn)=>callbacks[event]=fn,send:async(method,args)=>{if(args?.downloadPath)downloadPath=args.downloadPath;},detach:async()=>{}};
const page={bringToFront:async()=>{},goto:async()=>backgroundNavigations++,waitForSelector:async()=>{},close:async()=>{},
 keyboard:{press:async()=>mode=''},
 evaluate:async(fn,args)=>{
  if(fn.name==='metrics')return {top:0,scroll:500,client:500};
  if(fn.name==='tileSnapshot')return [1,2,3].map(n=>({key:`tile-${n}`,assetId:`asset-${n}`,text:`Prompt ${n}`,ready:true}));
  if(fn.name==='menuItems')return mode==='download'?[{text:'Download',x:30,y:40}]:mode==='sizes'?(nativeOptions?[{text:'720p Original',x:40,y:50},{text:'1080p Upscaled',x:50,y:60}]:[{text:'360p Original',x:40,y:50},{text:'720p Upscaled',x:50,y:60}]):[];
  if(fn.name==='openClipMenu'){mode='download';menuClicks++;return {ok:true,direct:false};}
  if(fn.name==='clickMenuText'){
   if(args==='Download')mode='sizes';
   else if(args==='720p Upscaled'||args==='720p Original'){
    const guid=`guid-${++downloads}`;fs.copyFileSync(fixture,path.join(downloadPath,guid));
    callbacks['Browser.downloadWillBegin']({guid});callbacks['Browser.downloadProgress']({guid,state:'completed'});
   }
   return true;
  }
 },
 mouse:{move:async()=>{throw Error('background mouse event forbidden');},click:async()=>{throw Error('background mouse event forbidden');}}

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
 console.log('PASS: scoped Upscaled menu clicks, CDP completion, real saved 720p files, skip on resume, scene-order manifest, no partial overwrite, one background tab.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(folder,{recursive:true,force:true}));
