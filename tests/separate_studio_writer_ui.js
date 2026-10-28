const assert=require('assert'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer');
(async()=>{
 const testDir=fs.mkdtempSync(path.join(require('os').tmpdir(),'studio-txt-'));
 const txt=path.join(testDir,'batch-stories.txt'),empty=path.join(testDir,'empty.txt');
 const ready='Story 1\nTitle: Test import\nClip seconds: 8\nSetting: A living room\nClip 1:\nSarah: Hello.\nSAM: Hi.';
 fs.writeFileSync(txt,ready);fs.writeFileSync(empty,'');
 const browser=await puppeteer.launch({headless:true});
 try{
  for(const writer of [false,true]){
   const page=await browser.newPage(),headers=[],errors=[];
   page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
   page.on('request',async req=>{
    const url=new URL(req.url());
    if(url.pathname.startsWith('/assets/'))return req.respond({status:200,contentType:url.pathname.endsWith('.js')?'text/javascript':'text/css',body:fs.readFileSync(path.join(__dirname,'../desktop_ui',path.basename(url.pathname)))});
    if(url.pathname==='/')return req.respond({status:200,contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../desktop_ui/index.html'),'utf8').replace('__SESSION_TOKEN__','test')});
    if(url.pathname.startsWith('/api/')){
     headers.push(req.headers()['x-studio-surface']);let data={};
     if(url.pathname==='/api/bootstrap')data={defaults:{preset:'relationship-dialogue-dog-couple',aspect:'9:16',transport:'web',cdp:9222},presets:[{id:'relationship-dialogue-dog-couple',name:'Dog couple'}],models:['Omni 1.1 Flash'],preferences:{theme:'crimson',current:'writer',forms:{}},workflowDefaults:{}};
     if(url.pathname==='/api/master-prompt')data={name:'Dog couple',text:'Complete saved master prompt with parser fields.'};
     if(url.pathname==='/api/library')data=[];
     if(url.pathname==='/api/accounts')data={accounts:[]};
     if(url.pathname==='/api/jobs')data=[{id:'flow',lane:'flow',action:'generate',status:'running'}];
     if(url.pathname==='/api/jobs/flow')data={id:'flow',lane:'flow',status:'running',cursor:0,logs:[]};
     return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
    }
    return req.respond({status:404,body:''});
   });
   await page.goto('http://studio.local/'+(writer?'?writer=1':''));await page.waitForSelector('#readyScript');
   assert.equal(await page.$$eval('#navigation [data-view]',nodes=>nodes.length),writer?2:10);
   await page.select('#theme-picker','lime');
   assert.equal(await page.$eval('html',el=>el.dataset.theme),'lime');
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('.button.primary')).color==='rgb(26, 26, 26)');
   const palette=await page.$eval('.button.primary',el=>({background:getComputedStyle(el).backgroundImage,text:getComputedStyle(el).color}));
   assert(palette.background.includes('209, 254, 23'));assert.equal(palette.text,'rgb(26, 26, 26)');
   if(!writer){fs.mkdirSync(path.join(__dirname,'../logs'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../logs/lime_theme_preview.png'),fullPage:true});}
   assert.equal(await page.$eval('#open-writer-window',el=>el.classList.contains('hidden')),writer);
   assert.equal(await page.$$eval('[data-open-writer]',nodes=>nodes.length),writer?0:1);
   assert(headers.every(h=>h===(writer?'writer':'studio')));
   assert.equal(await page.$eval('#running-pill',el=>el.textContent),writer?'No active jobs':'1 active job');
   await page.click('[data-source="script"]');assert(await page.$eval('#import-script',el=>!el.classList.contains('hidden')));
   const upload=await page.$('#ready-txt-file');await upload.uploadFile(txt);
   await page.waitForFunction(expected=>document.querySelector('#readyScript').value===expected,{},ready);
   assert.equal(await page.$eval('#ready-txt-name',el=>el.textContent),'batch-stories.txt');
   assert((await page.$eval('#duration-summary',el=>el.textContent)).includes('1 clips'));
   await upload.uploadFile(empty);await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('empty'));
   assert.equal(await page.$eval('#readyScript',el=>el.value),ready,'invalid file preserves existing text');
   await page.click('[data-view="writer"]');await page.waitForSelector('#readyScript');
   assert.equal(await page.$eval('#readyScript',el=>el.value),ready,'loaded text survives view rerender without persisting a browser fakepath');
   await page.click('[data-view="prompts"]');
   await page.waitForFunction(()=>document.querySelector('#master-prompt-text')?.value==='Complete saved master prompt with parser fields.');
   assert.equal(await page.$eval('#masterPreset',el=>el.value),'relationship-dialogue-dog-couple');
   assert.equal(await page.$eval('#copy-master-prompt',el=>el.disabled),false);
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedMaster=text;}},configurable:true}));
   await page.click('#copy-master-prompt');
   assert.equal(await page.evaluate(()=>window.copiedMaster),'Complete saved master prompt with parser fields.');
   if(!writer)for(const view of ['agent','ingredients','omni']){
    await page.click(`[data-view="${view}"]`);
    await page.waitForSelector('[data-action="fix_join"]');
    assert.equal(await page.$eval('[data-action="fix_join"]',el=>el.textContent),'Fix order & Join');
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: full Studio and dedicated writer render correctly, route preferences separately, retain direct import and isolate writer job logs. Mock API/headless UI only.');
 }finally{await browser.close();fs.rmSync(testDir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
