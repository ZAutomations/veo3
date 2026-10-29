const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),net=require('net'),assert=require('assert');
(async()=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'generation-modes-'));let server,browser;
try{
 const l=net.createServer();await new Promise(r=>l.listen(0,'127.0.0.1',r));const port=l.address().port;await new Promise(r=>l.close(r));server=cp.spawn('python',[path.join(__dirname,'serve_video_editing.py'),String(port),tmp],{windowsHide:true,stdio:'ignore',cwd:path.resolve(__dirname,'..')});const base='http://127.0.0.1:'+port;
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,150));}
 browser=await require('puppeteer').launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();await page.setViewport({width:1440,height:1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base,{waitUntil:'networkidle0'});
 await page.click('.nav-item[data-view="agent"]');await page.waitForSelector('.generation-mode-columns');
 assert.equal(await page.$$('.nav-item[data-view="ingredients"]').then(x=>x.length),0);assert.equal(await page.$$('.generation-mode-column').then(x=>x.length),2);
 const heights=await page.$$eval('.generation-mode-column>.panel',es=>es.map(e=>e.getBoundingClientRect().height));assert(Math.abs(heights[0]-heights[1])<1);
 assert.equal(await page.$eval('#model',e=>e.type),'hidden');
 await page.$eval('#story',e=>e.value='C:/tests/agent-story.json');await page.$eval('#project',e=>e.value='https://flow.google.com/project/agent-test');
 await page.click('#mode-toggle-ingredients');assert.equal(await page.$eval('#mode-toggle-ingredients',e=>e.checked),true);assert.equal(await page.$eval('#mode-toggle-agent',e=>e.checked),false);
 await page.$eval('#story',e=>e.value='C:/tests/ingredients-story.json');await page.$eval('#project',e=>e.value='https://flow.google.com/project/ingredients-test');
 await page.click('.nav-item[data-view="settings"]');await page.waitForSelector('#globalVideoModel');for(const id of ['globalVideoModel','globalVideoAspect','globalVideoResolution','globalVideoDownloadVersion','globalVideoSeconds','globalAutomationCdp','globalAgentBatchSize'])assert(await page.$('#'+id),id);
 await page.click('.nav-item[data-view="agent"]');assert.equal(await page.$eval('#mode-toggle-ingredients',e=>e.checked),true,'Return to last selected mode');assert.equal(await page.$eval('#story',e=>e.value),'C:/tests/ingredients-story.json');
 await page.click('#mode-toggle-agent');assert.equal(await page.$eval('#story',e=>e.value),'C:/tests/agent-story.json');assert.equal(await page.$eval('#project',e=>e.value),'https://flow.google.com/project/agent-test');
 const folder=path.resolve(__dirname,'../logs/unified-generation');fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:path.join(folder,'generation.png')});
 await page.setViewport({width:1050,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
 console.log('PASS: exclusive Agent/Ingredients mode toggles, equal card heights, one nav tab, retained per-mode inputs, Settings video controls and responsive width.');
}finally{if(browser)await browser.close();if(server){server.kill();await new Promise(r=>server.on('close',r));}assert.equal(path.dirname(tmp).toLowerCase(),os.tmpdir().toLowerCase());fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
