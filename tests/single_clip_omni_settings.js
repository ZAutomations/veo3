const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
let open=false,menu=false,model='Veo 3.1 - Fast',ignoredOpens=1,openAttempts=0;
const selected={type:'Image',mode:'Ingredients',ratio:'16:9',count:'x1',resolution:'360p'};
const rect=()=>({x:10,y:10,width:200,height:40});
const radio=(label,group)=>({getBoundingClientRect:rect,querySelector:()=>({textContent:label}),
 getAttribute:a=>a==='aria-checked'?String(selected[group]===label):null,
 scrollIntoView:()=>{},click:()=>selected[group]=label});
const radios=[radio('Video','type'),radio('Image','type'),radio('Ingredients','mode'),radio('16:9','ratio'),
 radio('9:16','ratio'),radio('x1','count'),radio('360p','resolution'),radio('720p','resolution')];
const summary={get innerText(){return `${model} ${selected.ratio} ${selected.resolution} x1`;},getBoundingClientRect:rect,scrollIntoView:()=>{},click:()=>{openAttempts++;if(ignoredOpens)ignoredOpens--;else open=true;}};
const editor={getBoundingClientRect:rect};
const trigger={getBoundingClientRect:rect,scrollIntoView:()=>{},get innerText(){return model;},click:()=>menu=true};
const item={getBoundingClientRect:rect,scrollIntoView:()=>{},innerText:'Omni 1.1 Flash',
 querySelector:()=>({textContent:'Omni 1.1 Flash'}),click:()=>{model='Omni 1.1 Flash';open=false;menu=false;}};
const root={querySelector:()=>trigger,querySelectorAll:()=>radios,getBoundingClientRect:rect};
const doc={querySelector:s=>s.includes('Settings trigger')?summary:s==='flow-prompt-box-settings'?(open?root:null):s.includes('Select model family')?(open?trigger:null):null,
 querySelectorAll:s=>s.includes('ProseMirror')?[editor]:s.includes('Settings trigger')?[summary]:s.includes('menuitem')?(menu?[item]:[]):s.includes('role="radio"')?(open?radios:[]):[]};
const handle=e=>({click:async()=>e.click(),evaluate:async(fn,...args)=>fn(e,...args)});
const page={url:()=> 'https://flow.google.com/project/test-settings',$$:async s=>{
 const els=s==='flow-prompt-box-settings'?(open?[root]:[]):s.includes('Settings trigger')?[summary]:
 s.includes('Select model family')?(open?[trigger]:[]):s.includes('menuitem')?(menu?[item]:[]):s.includes('role="radio"')?(open?radios:[]):[];
 return els.map(handle);
},evaluate:async(fn,...args)=>fn(...args),waitForSelector:async()=>assert(open),
 waitForFunction:async(fn,opts,...args)=>assert(fn(...args)),keyboard:{press:async()=>open=false}};
const mod={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../single_clip_omni_settings.js'),'utf8'),{
 document:doc,module:mod,exports:mod.exports,require:n=>n==='./generate_refs'?{setAgent:async()=>({ok:true})}:n==='./project_setup'?{}:{normalizeProjectUrl:u=>u}
});
(async()=>{
 assert(mod.exports.summaryMatches('Video · 360p · 8s x1',{model:'Omni 1.1 Flash',resolution:'360p',ratio:'9:16'}));
 assert(!mod.exports.summaryMatches('Video · 720p · 8s x1',{model:'Omni 1.1 Flash',resolution:'360p',ratio:'9:16'}));
 for(const resolution of ['720p','360p']){
  await mod.exports.prepareVideo(page,{model:'Omni 1.1 Flash',ratio:'9:16',resolution});
  assert.equal(model,'Omni 1.1 Flash');assert.equal(selected.ratio,'9:16');assert.equal(selected.resolution,resolution);
  assert.equal(selected.type,'Video');assert(!open,'panel must be closed after verification');
 }
 assert(openAttempts>=3,'an ignored opening click must be retried in place');
 const before=openAttempts;
 await mod.exports.prepareVideo(page,{model:'Omni 1.1 Flash',ratio:'9:16',resolution:'360p'});
 assert.equal(openAttempts,before,'same settings after first submission must not reopen the panel');
 selected.ratio='16:9';
 await mod.exports.prepareVideo(page,{model:'Omni 1.1 Flash',ratio:'9:16',resolution:'360p'});
 assert.equal(selected.ratio,'9:16','detect and fix a changed summary');
 assert(openAttempts>before);
 console.log('PASS: resolution/ratio verification, ignored-opening retry, cached settings reuse after submission, and changed-setting correction without reload.');
})().catch(e=>{console.error(e);process.exitCode=1;});
