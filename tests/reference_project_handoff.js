const assert=require('assert');
const {configureReferenceImages}=require('../reference_image_step');
let opened=false,image=false,ratio=false,model='Omni 1.2 Flash',clicks=0,dropFirstOpen=false;
const visible=()=>({width:200,height:40,x:10,y:10});
function node(label,click){return {getBoundingClientRect:visible,disabled:false,textContent:label,
 cloneNode(){return {textContent:typeof label==='function'?label():label,querySelectorAll:()=>[]};},
 querySelector:()=>null,querySelectorAll:()=>[],getAttribute:()=>null,closest:()=>null,click};}
const imageButton=node('Image',()=>image=true);imageButton.getAttribute=()=>String(image);
const ratioButton=node('16:9',()=>ratio=true);ratioButton.getAttribute=()=>String(ratio);
const modelButton=node(()=>model,()=>{});
const pro=node('Nano Banana Pro',()=>model='Nano Banana Pro');pro.closest=s=>s.includes('Select model family')?null:pro;
const panel={querySelectorAll:s=>s.includes('Select model')?[modelButton]:s==='button[role="radio"]'?[imageButton,ratioButton]:[]};
imageButton.closest=()=>opened?panel:null;
const summary=node(()=>`${image?'Image':'Video'} ${model} x1`,()=>{clicks++;if(dropFirstOpen){dropFirstOpen=false;return;}opened=true;});
summary.closest=()=>summary;summary.querySelectorAll=()=>ratio?[{textContent:'crop_16_9'}]:[];
global.getComputedStyle=()=>({display:'block',visibility:'visible'});
let obscuredTrigger=false;
const fullSettings=node('',()=>{throw Error('Clicked full Settings drawer instead of compact trigger');});
const coveredTrigger=node('',()=>{throw Error('Clicked covered compact trigger');});
fullSettings.getBoundingClientRect=()=>({width:40,height:40,x:300,y:10});
coveredTrigger.getBoundingClientRect=()=>({width:40,height:40,x:400,y:10});
summary.getAttribute=name=>name==='aria-label'?'Settings trigger':null;
fullSettings.getAttribute=name=>name==='aria-label'?'Settings':null;
coveredTrigger.getAttribute=summary.getAttribute;
coveredTrigger.contains=()=>false;
global.document={querySelectorAll:s=>{
 if(s==='.settings-summary')throw Error('Legacy settings class must not be queried');
 if(s==='button[aria-label="Settings trigger"]')
  return obscuredTrigger?[fullSettings,coveredTrigger,summary]:[summary];
 if(s.includes('span.label'))return opened?[pro]:[];
 return opened&&s==='button[role="radio"]'?[imageButton,ratioButton]:[];
},elementFromPoint:x=>x===320?fullSettings:summary};
const page={evaluate:async(fn,arg)=>fn(arg),keyboard:{press:async()=>opened=false},mouse:{click:async x=>document.elementFromPoint(x).click()}};
(async()=>{
 for(const mixedLayout of [false,true]){
  obscuredTrigger=mixedLayout;dropFirstOpen=true;
  opened=false;image=false;ratio=false;model='Omni 1.2 Flash';
  await configureReferenceImages(page);
  assert(image&&ratio&&model==='Nano Banana Pro'&&!opened);
 }
 assert.equal(clicks,4,'each discarded first click is retried once; an open panel is never toggled');
 console.log('PASS: compact settings are verified with a standalone trigger and with a full drawer button and covered trigger present.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{delete global.document;delete global.getComputedStyle;});
