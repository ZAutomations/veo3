const assert=require('assert');
const {EventEmitter}=require('events');
const {prepareBackground}=require('../automation_browser');
(async()=>{
 let state='normal',restores=0,clicks=0,types=0;
 const page=new EventEmitter();
 page.createCDPSession=async()=>({send:async(method)=>{
  if(method==='Emulation.setFocusEmulationEnabled')return{};
  if(method==='Browser.getWindowForTarget')return{windowId:11,bounds:{windowState:state}};
  throw Error('unexpected CDP call '+method);
 }});
 page.mouse={click:async()=>{clicks++;},doubleClick:async()=>{},move:async()=>{},down:async()=>{},up:async()=>{},wheel:async()=>{}};
 page.keyboard={press:async()=>{},type:async()=>{types++;},down:async()=>{},up:async()=>{}};
 const browser=new EventEmitter();browser.pages=async()=>[page];browser.setWindowBounds=async(id,bounds)=>{
  assert.equal(id,11);assert.equal(bounds.windowState,'normal');state='normal';restores++;
 };
 const logs=[];await prepareBackground(browser,message=>logs.push(message));
 state='minimized';await page.mouse.click(30,40);
 assert.equal(state,'normal');assert.equal(restores,1);assert.equal(clicks,1);
 state='minimized';await new Promise(resolve=>setTimeout(resolve,375));await page.keyboard.type('test');
 assert.equal(state,'normal');assert.equal(restores,2);assert.equal(types,1);
 assert.equal(logs.filter(line=>/was minimized; restored/.test(line)).length,2);
 console.log('PASS: minimized Chrome window is restored before pointer and keyboard input; later minimization is detected again.');
})().catch(error=>{console.error(error);process.exitCode=1;});
