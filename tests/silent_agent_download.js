const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),vm=require('vm');
const A=require('../agent_upscaled_download'),S=require('../silent_scene_identity'),media=require('../single_clip_omni_media');
(async()=>{
 const story={narrated:false,scenes:Array.from({length:8},(_,i)=>({script_line:'',dialogue:[],veo3_prompt:`Standalone visual prompt number ${i+1}`,shots:[{visual:`Cat carries the brown teddy toward furniture marker number ${i+1} beside the blue window.`},{visual:`Girl places cushion number ${i+1} beside the cream sofa while the cat waits on the oak floor.`}]}))};
 assert(S.isSilent(story));
 const tiles=story.scenes.map((s,i)=>({index:i,assetId:'asset-'+i,prompt:s.shots.map(x=>x.visual).join(' '),text:'360p',ready:true}));
 assert.equal(A.plan(tiles,story).length,8);
 assert(media.promptMatches({text:tiles[0].prompt},{scene:story.scenes[0],silentVisual:true}));
 assert(!media.promptMatches({text:tiles[0].prompt},{scene:story.scenes[1],silentVisual:true}));
 assert.throws(()=>A.plan(tiles.map(t=>({...t,prompt:tiles.map(x=>x.prompt).join(' ')})),story),/multiple/);
 const spoken={scenes:[{script_line:'This exact spoken sentence is long enough to identify a clip.'}]};
 assert.equal(A.plan([{index:0,assetId:'spoken',prompt:spoken.scenes[0].script_line}],spoken)[0].receipt.assetId,'spoken');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'silent-download-'));
 try{
  const storyFile=path.join(temp,'sample_story.json'),project='https://flow.google.com/project/silent-test';fs.writeFileSync(storyFile,JSON.stringify(story));
  fs.writeFileSync(path.join(temp,'agent_batches_silent-test.json'),JSON.stringify({project:'silent-test',fingerprint:crypto.createHash('sha256').update(fs.readFileSync(storyFile)).digest('hex'),total:8,completed:8,pending:null}));
  const captions=tiles.map(t=>({...t,prompt:'',text:'play_circle 360p'}));
  assert.equal(A.assetPlan(captions,story,storyFile,project).length,8);
  const captures=[];let inspectCalls=0;
  for(const exact of [true,false]){
   const mod={exports:{}};
   const Fake=class{constructor(engine,options){this.options=options;this.out=path.join(temp,'clips');fs.mkdirSync(this.out,{recursive:true});captures.push(this);}async group(jobs,receipts){this.jobs=jobs;this.receipts=receipts;}async close(){this.closed=true;}};
   const customRequire=n=>n==='./single_clip_omni_upscaled'?{UpscaledDownloader:Fake,videoInfo:()=>{}}:n==='./single_clip_omni_recovery'?{inspectProject:async()=>{inspectCalls++;if(!exact)throw Error('multiple matching video tiles');return {tiles:tiles.map(t=>({...t,sourcePrompt:t.prompt}))};}}:n.startsWith('./')?require(path.join(__dirname,'..',n)):require(n);
   vm.runInNewContext(fs.readFileSync(require.resolve('../agent_upscaled_download'),'utf8'),{require:customRequire,module:mod,exports:mod.exports,console});
   await mod.exports.download({}, {}, {storyFile,project,tiles:captions,outDir:path.join(temp,'clips')});
   const d=captures.at(-1);assert.equal(d.jobs.length,8);assert(d.closed);assert.equal(d.options.orderMode,exact?'scene':'unresolved-assets');
   assert(Object.values(d.receipts).every(r=>r.nativeResolution===360&&!r.native720));
  }
  assert.equal(inspectCalls,2);assert(fs.readFileSync(path.join(temp,'clips/CLIP_ORDER.txt'),'utf8').includes('music and meows cannot establish order'));
  console.log('PASS: silent visual sources map all eight scenes; ambiguous batch prompts still collect eight verified unique assets without guessed order; native 360p preserved; spoken matching unchanged. No browser/download used.');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
