const assert=require('assert');
const {selectImages}=require('../reference_picker_images');
const {Veo3FlowNewUI}=require('../veo3_flow_new_ui');
let clicks=0,chosen='All',acceptClick=true,missing=false;
const rect=()=>({x:100,y:100,width:80,height:40});
const labels=['All','Images','Videos'].map(text=>{
 const parent={get className(){return chosen===text?'side-nav-list-item-active':'';},hasAttribute:()=>false,parentElement:null,querySelector:()=>null};
 return {textContent:text,getBoundingClientRect:rect,closest:()=>parent,parentElement:parent,hasAttribute:()=>false,className:''};
});
const prior=global.document;
global.document={querySelectorAll:()=>missing?[]:labels};
const page={evaluate:async(fn,...args)=>fn(...args),mouse:{click:async()=>{clicks++;if(acceptClick)chosen='Images';}},
 waitForFunction:async(fn,opts,...args)=>{if(!fn(...args))throw Error('not selected');}};
(async()=>{
 await selectImages(page);assert.equal(chosen,'Images');assert.equal(clicks,1);
 await selectImages(page);assert.equal(clicks,1,'already selected Images should stay selected');
 chosen='All';acceptClick=false;
 await assert.rejects(selectImages(page),/did not confirm/);
 missing=true;await assert.rejects(selectImages(page),/not found/);
 missing=false;acceptClick=true;chosen='All';
 const omni=new Veo3FlowNewUI('unused.json',{referenceCategory:'Images'});
 omni.page=page;omni.evalJs=async()=>true;
 await omni.openAssetPicker();assert.equal(chosen,'Images','Omni must filter an already-open picker too');
 chosen='All';const original=new Veo3FlowNewUI('unused.json',{});original.page=page;original.evalJs=async()=>true;
 await original.openAssetPicker();assert.equal(chosen,'All','existing Ingredients behavior must remain unchanged');
 console.log('PASS: Images selection, missing/unconfirmed category blocks, Omni picker integration, unchanged Ingredients path.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>global.document=prior);
