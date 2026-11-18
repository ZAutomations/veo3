const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
(async()=>{const folder=fs.mkdtempSync(path.join(os.tmpdir(),'scene-cache-'));try{
let revision='one',builds=0;
const original=fs.readFileSync.bind(fs),fake=Object.create(fs);
fake.readFileSync=(file,...args)=>path.basename(String(file))==='agent_scene_ids.js'?original(file,...args)+'\n// '+revision:original(file,...args);
const mod={exports:{}};vm.runInNewContext(original(require.resolve('../agent_batches'),'utf8'),{require:n=>n==='fs'?fake:require(n),module:mod,__dirname:path.resolve(__dirname,'..'),console});
const storyFile=path.join(folder,'story.json');fs.writeFileSync(storyFile,JSON.stringify({scene_seconds:8,scenes:[{}]}));
const state={project:'cache',fingerprint:'same-story',aspect:'9:16',total:1,completed:0,size:1};
const run=async(_,args)=>{builds++;fs.writeFileSync(args[args.indexOf('--out')+1],'prompt revision '+revision);return {code:0}};
await mod.exports.prepareAgentBatches({},storyFile,state,run);assert.equal(builds,1);
await mod.exports.prepareAgentBatches({},storyFile,state,run);assert.equal(builds,1);
revision='two';await mod.exports.prepareAgentBatches({},storyFile,state,run);assert.equal(builds,2,'unsubmitted cache must include scene-ID contract changes');
state.pending={from:1,to:1};revision='three';const result=await mod.exports.prepareAgentBatches({},storyFile,state,run);assert.equal(builds,2,'already-submitted pending prompt must never change');assert(fs.readFileSync(result[0].prompt,'utf8').includes('two'));
console.log('PASS: scene-ID changes invalidate fresh prompt cache while preserving exact pending submissions.');
}finally{fs.rmSync(folder,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
