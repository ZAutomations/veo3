const assert=require('assert');
const R=require('../reference_picker_images');
const rect=()=>({width:100,height:30});
const old=global.document;
let assets=[{getBoundingClientRect:rect,querySelector:selector=>selector.includes('voice-icon')?{}:null}];
const picker={querySelectorAll:()=>assets};
const item={className:'',hasAttribute:a=>a==='aria-selected',getAttribute:()=> 'false',parentElement:null,querySelector:()=>null};
const label={textContent:'Voices',className:'',getBoundingClientRect:rect,hasAttribute:()=>false,parentElement:item,closest:s=>s==='.cdk-overlay-pane'?picker:item};
global.document={querySelectorAll:()=>[label]};
try{
 assert(R.categoryStateSelected('Voices'),'actual voice thumbnails confirm the category even if wrapper selection is stale');
 assets=[{getBoundingClientRect:rect,querySelector:()=>null}];
 assert(!R.categoryStateSelected('Voices'),'image/video cards cannot confirm the Voices category');
 assets=[];assert(!R.categoryStateSelected('Voices'),'empty unselected picker is not confirmed');
}finally{global.document=old;}
(async()=>{
 let focused=0,clicks=0,checks=0;
 const page={bringToFront:async()=>focused++,mouse:{click:async()=>clicks++},evaluate:async fn=>fn===R.categoryState?{found:true,selected:false,x:20,y:30}:false,waitForFunction:async(fn,opts)=>{assert.equal(opts.polling,100);assert(opts.timeout<=4000);if(++checks===1)throw Error('first click lost');}};
 await R.selectCategory(page,'Voices');assert.equal(focused,1);assert.equal(clicks,2);
 page.waitForFunction=async()=>{throw Error('persistent failure')};clicks=0;
 await assert.rejects(R.selectCategory(page,'Voices'),/after 3 checks/);assert.equal(clicks,3);
 console.log('PASS: voice-card readback, wrong-category rejection, timed polling, bounded category retry and foreground activation.');
})().catch(e=>{console.error(e);process.exitCode=1});
