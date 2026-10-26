const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('desktop_ui/app.js','utf8');
const start=source.indexOf('async function loadMasterPrompt(){'),end=source.indexOf('function renderLibrary(){',start);
const elements={masterPreset:{value:'first'},'copy-master-prompt':{},'master-prompt-text':{},'master-prompt-status':{}};
let pending=[];
const context=vm.createContext({current:'prompts',masterPromptLoad:0,$:id=>elements[id],encodeURIComponent,api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject}))});
vm.runInContext(source.slice(start,end),context);
(async()=>{
 const first=context.loadMasterPrompt();elements.masterPreset.value='second';const second=context.loadMasterPrompt();
 pending[1].resolve({text:'Second complete prompt',name:'Second'});await second;
 pending[0].resolve({text:'Outdated first prompt',name:'First'});await first;
 assert.equal(elements['master-prompt-text'].value,'Second complete prompt');assert.equal(elements['copy-master-prompt'].disabled,false);
 const missing=context.loadMasterPrompt();pending[2].reject(Error('Missing master prompt'));await missing;
 assert.equal(elements['master-prompt-text'].value,'');assert.equal(elements['copy-master-prompt'].disabled,true);
 assert.equal(elements['master-prompt-status'].textContent,'Missing master prompt');
 console.log('PASS: latest preset wins delayed requests; missing prompt clears stale text and disables copy.');
})().catch(e=>{console.error(e);process.exitCode=1});
