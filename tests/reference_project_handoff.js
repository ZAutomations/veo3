const assert=require('assert');
const {configureReferenceImages}=require('../reference_image_step');
let opened=false,image=false,ratio=false,model='Omni 1.1 Flash',clicks=0;
const visible=()=>({width:200,height:40,x:10,y:10});
function node(label,click){return {getBoundingClientRect:visible,disabled:false,textContent:label,
 cloneNode(){return {textContent:typeof label==='function'?label():label,querySelectorAll:()=>[]};},
 querySelector:()=>null,querySelectorAll:()=>[],getAttribute:()=>null,closest:()=>null,click};}
const imageButton=node('Image',()=>image=true);imageButton.getAttribute=()=>String(image);
const ratioButton=node('16:9',()=>ratio=true);ratioButton.getAttribute=()=>String(ratio);
const modelButton=node(()=>model,()=>{});
const pro=node('Nano Banana Pro',()=>model='Nano Banana Pro');pro.closest=s=>s.includes('Select model family')?null:pro;
const panel={querySelectorAll:s=>s.includes('Select model')?[modelButton]:[imageButton,ratioButton]};
imageButton.closest=()=>opened?panel:null;
const summary=node(()=>`${image?'Image':'Video'} ${model}`,()=>{opened=true;clicks++;});
summary.closest=()=>summary;summary.querySelectorAll=()=>ratio?[{textContent:'crop_16_9'}]:[];
global.getComputedStyle=()=>({display:'block',visibility:'visible'});
global.document={querySelectorAll:s=>s==='.settings-summary'?[summary]:s.includes('span.label')?[pro]:opened?[imageButton,ratioButton]:[]};
const page={evaluate:async(fn,arg)=>fn(arg),keyboard:{press:async()=>opened=false},mouse:{click:async()=>{throw Error('stale coordinate clicks must not be used');}}};
(async()=>{
 for(let story=0;story<2;story++){
  opened=false;image=false;ratio=false;model='Omni 1.1 Flash';
  await configureReferenceImages(page);
  assert(image&&ratio&&model==='Nano Banana Pro'&&!opened);
 }
 assert.equal(clicks,2,'each new project opens compact settings once, never blind toggling');
 console.log('PASS: second-story inherited Video settings switch to Image/16:9/Pro through exact controls without mouse coordinates.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{delete global.document;delete global.getComputedStyle;});
