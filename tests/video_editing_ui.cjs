const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),net=require('net');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'veo-editing-ui-'));
let server,browser,stderr='';
(async()=>{
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 server=spawn('python',[path.join(__dirname,'serve_video_editing.py'),String(port),temporary],{cwd:root,windowsHide:true});server.stderr.on('data',b=>stderr+=b);
 const url=`http://127.0.0.1:${port}`;
 for(let n=0;n<80;n++){try{const r=await fetch(url);if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await require('puppeteer').launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();await page.setViewport({width:1420,height:1050});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('.editing-style-tile',{timeout:30000});
 assert.equal(await page.$$('.editing-style-tile').then(x=>x.length),5);
 assert.equal(await page.$eval('#edit-clipper_captions_enabled',e=>e.checked),false);
 await page.locator('.editing-switch').click();await page.locator('[data-edit-style="pop"]').click();await page.$eval('[data-edit-swatch="#2BFF5A"]',e=>e.scrollIntoView({block:'center',behavior:'instant'}));await page.evaluate(()=>new Promise(requestAnimationFrame));await page.locator('[data-edit-swatch="#2BFF5A"]').click();await page.locator('[data-edit-position="center"]').click();await page.locator('[data-edit-size="87.84"]').click();
 assert.equal(await page.$eval('#edit-clipper_override_highlight_color',e=>e.value),'#2BFF5A');
 assert.equal(await page.$eval('#edit-caption_font_size',e=>e.value),'87.84');
 assert.equal(await page.$eval('#edit-caption_position',e=>e.value),'center');
 await page.locator('#load-editing-preview').click();await page.waitForFunction(()=>document.querySelector('#editing-preview-image')?.src.startsWith('data:image/jpeg'),{timeout:60000});
 const image=await page.$eval('#editing-preview-image',e=>e.src);assert(image.length>12000,'Caption preview must contain rendered text, not an empty background.');
 await page.locator('#play-editing-preview').click();await page.waitForFunction(()=>document.querySelector('#editing-preview-video')?.readyState>=2,{timeout:60000});
 assert(await page.$eval('#editing-preview-video',e=>e.duration>0));
 await page.$eval('[data-edit-range="editing_speed"]',el=>{el.value=1.25;el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#save-video-editing').click();await page.waitForFunction(()=>document.querySelector('#editing-save-status').textContent.startsWith('Saved'),{timeout:10000});
 const saved=JSON.parse(fs.readFileSync(path.join(temporary,'video_editing_settings.json'),'utf8'));
 assert.equal(saved.editing_speed,1.25);
 assert.equal(saved.clipper_caption_preset,'frameloom_bold_pop');
 assert.equal(saved.caption_font_size,87.84);assert.equal(saved.caption_position,'center');assert.equal(saved.clipper_override_highlight_color,'#2BFF5A');assert(saved.clipper_captions_enabled);
 await page.$eval('#editing-preview-video',e=>e.pause());
 await page.$eval('#editingPreviewTime',e=>{e.value=.4;e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>document.querySelector('#editing-preview-image')?.classList.contains('hidden')===false&&document.querySelector('#editing-preview-status')?.textContent.includes('exact ASS'),{timeout:30000});
 await page.evaluate(()=>{document.querySelector('#toast').style.display='none';document.querySelector('header').style.visibility='hidden';document.querySelector('#activity').style.visibility='hidden';});
 const artifacts=path.join(root,'logs','editing-ui-check');fs.mkdirSync(artifacts,{recursive:true});
 await (await page.$('.editing-captions')).screenshot({path:path.join(artifacts,'captions-card.png')});
 assert.deepEqual(errors,[]);
 await page.setViewport({width:1050,height:850});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 console.log('PASS: isolated UI, five style tiles, colour/position/size, real ASS frame and playable preview, settings persistence and laptop width.');
})().catch(e=>{console.error(e);console.error(stderr.slice(-1500));process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();if(server){server.kill();await new Promise(r=>server.on('close',r));}
 assert.equal(path.dirname(temporary).toLowerCase(),os.tmpdir().toLowerCase());fs.rmSync(temporary,{recursive:true,force:true});
});
