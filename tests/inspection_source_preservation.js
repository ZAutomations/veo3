const assert=require('assert');
const recovery=require('../single_clip_omni_recovery');
const missing=require('../agent_missing_scenes');
(async()=>{
 const story={scenes:Array.from({length:5},(_,i)=>({script_line:`The unique scientific explanation for scene ${i+1} covers a different specific mechanism ${i+1}.`}))};
 const jobs=story.scenes.map((scene,i)=>({number:i+1,scene,prompt:scene.script_line}));
 let copied='',creates=0,closed=0,reads=0;
 const browser={newPage:async()=>{
  const attempt=++creates;
  return {goto:async()=>{},bringToFront:async()=>{},waitForSelector:async()=>{},close:async()=>{closed++;},waitForFunction:async()=>{},evaluate:async(fn,arg)=>{
   if(attempt===1&&fn.name==='tileSnapshot')throw Error('Execution context was destroyed, most likely because of a navigation.');
   if(fn.name==='metrics')return {top:68,scroll:668,client:600,visible:true};
   if(fn.name==='tileSnapshot'){reads++;return [1,4].map(n=>({key:'key'+n,assetId:'asset'+n,text:'play_circle generated caption',ready:true}));}
   if(fn.name==='reuseForInspection'){copied=jobs[Number(arg.assetId.slice(5))-1].prompt;return {previous:'old'};}
   if(!fn.name)return copied;
  }};
 }};
 const result=await recovery.inspectProject({browser,projectUrl:'https://flow.google.com/project/test',page:{bringToFront:async()=>{}}},jobs,{}, {sleep:async()=>{}});
 assert.equal(creates,2);assert.equal(closed,2);assert(reads>=3);
 assert(result.exhaustive);assert(!result.unidentifiedSources);
 assert(result.found[1]?.ready&&result.found[4]?.ready);
 assert(result.tiles.every(t=>t.sourcePrompt&&t.text.includes(t.sourcePrompt)),'quiet bottom polling must preserve source prompts');
 assert.deepEqual(missing.planMissing(story,{from:1,to:5},result),{completed:[1,4],missing:[2,3,5]});
 console.log('PASS: navigation recovers in new read-only tab; quiet grid refresh preserves two source prompts; only three missing scenes selected. No Generate used.');
})().catch(e=>{console.error(e);process.exitCode=1;});
