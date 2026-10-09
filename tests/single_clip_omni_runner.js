const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const queue=require('../single_clip_omni_queue');
const realMedia=require('../single_clip_omni_media');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'veo-omni-test-'));
const storyFile=path.join(folder,'story.json');
fs.writeFileSync(storyFile,JSON.stringify({scenes:Array.from({length:12},(_,i)=>({veo3_prompt:`Prompt ${i+1}`,characters:['sarah','george']}))}));
let submits=0,refs=0,settingsCalls=[],promptNumbers=[],tiles=[],events=[],reloads=0;
class Engine{
 constructor(file,opts){assert.equal(opts.referenceCategory,'Images');this.opts=opts;this.genRefs=opts.genRefs;this.projectUrl=opts.projectUrl;this._refsGenerated=false;
  this.page={url:()=>this.projectUrl,goto:async()=>{reloads++;},evaluate:async fn=>fn.name==='gridMetrics'?{top:0}:null};this.browser={pages:async()=>[this.page],disconnect:async()=>{}};}
 async connect(){} async waitForFlowShell(){} async removeIngredientChipsFromExtend(){} async uploadStoryRefs(){}
 async typePrompt(p){this.prompt=p;assert(/^Prompt \d+$/.test(p));promptNumbers.push(Number(p.split(' ')[1]));}
 async selectRefsForScene(){refs++;return true;}
 async clickStartGeneration(){submits++;events.push(`submit:${this.prompt.split(' ')[1]}`);tiles.push({key:`key-${submits}`,assetId:`asset-${submits}`,text:this.prompt,ready:true,busy:false,failed:false});}
}
class Downloader{
 constructor(e,opts){this.check=opts.checkGeneration;this.ledger={clips:[]};}
 async group(jobs){await this.check();events.push('download:'+jobs.map(j=>j.number).join(','));}
 async close(){}
}
const project='https://flow.google.com/project/test-omni';
const moduleObject={exports:{}};
const mockRequire=name=>{
 if(name==='./veo3_flow_new_ui')return {Veo3FlowNewUI:Engine};
 if(name==='./refs_for_scene')return {loadStoryRefs:()=>({refs:[{name:'Sarah'},{name:'George'},{name:'Bedroom',kind:'place'}]})};
 if(name==='./flow_project')return {normalizeProjectUrl:u=>u};
 if(name==='./saved_couple')return {loadSavedCouple:()=>null,applySavedRefs:r=>r};
 if(name==='./single_clip_omni_settings')return {prepareReferences:async()=>{},prepareVideo:async(p,opts)=>settingsCalls.push(opts)};
 if(name==='./single_clip_omni_background')return {};
 if(name==='./single_clip_omni_backlog')return require('../single_clip_omni_backlog');
 if(name==='./single_clip_omni_retry')return require('../single_clip_omni_retry');
 if(name==='./single_clip_omni_media')return {...realMedia,snapshot:async()=>tiles};
 if(name==='./single_clip_omni_recovery')return {
  inspectProject:async(engine,jobs,receipts)=>({exhaustive:true,generatingSeen:false,tiles,found:Object.fromEntries(jobs.map(j=>[j.number,realMedia.locateJob(tiles,j,receipts[j.number])])),page:{close:async()=>{}}}),
  reconcilePending:require('../single_clip_omni_recovery').reconcilePending,
  confirmSubmission:async(page,job,receipt)=>{const tile=realMedia.locateJob(tiles,job,receipt);assert(tile);return {...receipt,key:tile.key,assetId:tile.assetId};}
 };
 if(name==='./single_clip_omni_upscaled')return {UpscaledDownloader:Downloader};
 if(name==='./flow_grid_scroll')return {installGridScroller:function installGridScroller(){},gridMetrics:function gridMetrics(){},wheelGrid:async()=>{throw Error('Unexpected grid scrolling');}};
 if(name==='./single_clip_omni_queue')return {runQueue:(jobs,deps)=>queue.runQueue(jobs,{...deps,sleep:async ms=>assert.equal(ms,5000)})};
 return require(name);
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../single_clip_omni.js'),'utf8'),{
 require:mockRequire,module:moduleObject,exports:moduleObject.exports,__dirname:path.join(__dirname,'..'),console:{log:()=>{}},setTimeout,process
});
(async()=>{
 const req={story:storyFile,project,from:1,to:12,model:'Omni 1.1 Flash',aspect:'9:16',resolution:'360p',reuseRefs:true,download:true};
 await moduleObject.exports.run(req);
 assert.equal(submits,12);assert.equal(refs,12);assert.equal(settingsCalls.length,12);assert.equal(reloads,0);
 assert.deepEqual(events.filter(e=>e.startsWith('download:')),['download:1,2,3,4,5','download:6,7,8,9,10','download:11,12']);
 assert(events.indexOf('download:1,2,3,4,5')>events.indexOf('submit:10'));
 assert(events.indexOf('download:1,2,3,4,5')<events.indexOf('submit:11'));
 for(const s of settingsCalls){assert.equal(s.resolution,'360p');assert.equal(s.model,req.model);assert.equal(s.ratio,'9:16');}
 await moduleObject.exports.run(req);assert.equal(submits,12,'completed clips must not be submitted again');
 await assert.rejects(moduleObject.exports.run({...req,resolution:'720p'}),/changed/);
 const state=JSON.parse(fs.readFileSync(path.join(folder,'single_clip_omni_test-omni_1_12.json'),'utf8'));
 assert.equal(state.completed.length,12);assert.equal(state.submitting,null);
 promptNumbers=[];
 await moduleObject.exports.run({...req,project:'https://flow.google.com/project/test-range',from:6,to:10});
 assert.deepEqual(promptNumbers,[6,7,8,9,10]);
 promptNumbers=[];
 await moduleObject.exports.run({...req,project:'https://flow.google.com/project/test-single',from:8,to:8});
 assert.deepEqual(promptNumbers,[8]);
 const resumedProject='https://flow.google.com/project/test-resumed-ranges';
 await moduleObject.exports.run({...req,project:resumedProject,from:1,to:5,download:false});
 events=[];promptNumbers=[];
 await moduleObject.exports.run({...req,project:resumedProject,from:6,to:10});
 assert.deepEqual(promptNumbers,[6,7,8,9,10]);
 assert(events.includes('download:1,2,3,4,5'),'previous completed range must download during the new range');
 assert(events.indexOf('download:1,2,3,4,5')>events.indexOf('submit:10'));
 events=[];
 await moduleObject.exports.run({...req,project:resumedProject,from:11,to:12,downloadOnly:true});
 assert(events.includes('download:1,2,3,4,5,6,7,8,9,10,11,12'),'download button must cover the whole story even with a tail range');
 const interruptedFile=path.join(folder,'single_clip_omni_test-resumed-ranges_6_10.json');
 const interrupted=JSON.parse(fs.readFileSync(interruptedFile));interrupted.completed=[];
 fs.writeFileSync(interruptedFile,JSON.stringify(interrupted));
 events=[];
 await moduleObject.exports.run({...req,project:resumedProject,from:11,to:12});
 assert(events.includes('download:1,2,3,4,5,6,7,8,9,10'),'clips completed after an interrupted range must be discovered and downloaded: '+JSON.stringify(events));
 assert(events.indexOf('download:1,2,3,4,5,6,7,8,9,10')>events.indexOf('submit:12'));
 console.log('PASS: exact ranges, no reloads/scans, references/settings, downloads during the next group, final download and checkpoint resume.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(folder,{recursive:true,force:true}));
