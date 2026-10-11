const assert=require('assert');
const {scanProjectMedia}=require('../agent_project_media');
(async()=>{
 const frame={scrollable:true,top:0,client:600,height:1400,tiles:[0,1,2].map(i=>({video:false,id:String(i),x:10,y:40+i*420,h:400}))};
 let scrolls=0;
 const page={evaluate:async fn=>{if(fn.name==='projectFrame')return frame;if(fn.name==='scrollGrid')scrolls++;},mouse:{move:async()=>{scrolls++;},wheel:async()=>{scrolls++;}}};
 frame.height=1320;
 const result=await scanProjectMedia(page,{wait:async()=>{}});
 assert(result.project_scan_complete);assert.equal(result.flow_image_tile,3);assert.equal(scrolls,0,'fully mounted inventory must not scroll');
 console.log('PASS: complete mounted project inventory avoids startup scrolling.');
})().catch(e=>{console.error(e);process.exitCode=1;});
