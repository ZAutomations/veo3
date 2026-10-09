const assert=require('assert');
const {scrollDownloadGrid}=require('../download_grid_scroll');
let events=0;
const scroller={scrollTop:0,scrollHeight:5000,clientHeight:730,dispatchEvent:()=>events++};
global.document={querySelector:()=>scroller};global.window={};
const page={evaluate:async(fn,arg)=>fn(arg),mouse:{move:async()=>{throw Error('Input.dispatchMouseEvent timed out');},wheel:async()=>{throw Error('Input.dispatchMouseEvent timed out');}}};
(async()=>{
 await scrollDownloadGrid(page,547);assert.equal(scroller.scrollTop,547);
 await scrollDownloadGrid(page,100000);assert.equal(scroller.scrollTop,4270);
 await scrollDownloadGrid(page,-100000);assert.equal(scroller.scrollTop,0);assert.equal(events,3);
 Object.defineProperty(scroller,'scrollTop',{get:()=>0,set:()=>{}});
 await assert.rejects(scrollDownloadGrid(page,547),/did not advance/);
 console.log('PASS: download grid advances without mouse input, clamps at bounds and rejects an unresponsive container.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{delete global.document;delete global.window;});
