const assert=require('assert'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer');
(async()=>{
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
     if(url.pathname==='/api/library')data=[];
     if(url.pathname==='/api/accounts')data={accounts:[]};
     if(url.pathname==='/api/jobs')data=[{id:'flow',lane:'flow',action:'generate',status:'running'}];
     if(url.pathname==='/api/jobs/flow')data={id:'flow',lane:'flow',status:'running',cursor:0,logs:[]};
     return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
    }
    return req.respond({status:404,body:''});
   });
   await page.goto('http://studio.local/'+(writer?'?writer=1':''));await page.waitForSelector('#readyScript');
   assert.equal(await page.$$eval('#navigation [data-view]',nodes=>nodes.length),writer?1:8);
   assert.equal(await page.$eval('#open-writer-window',el=>el.classList.contains('hidden')),writer);
   assert.equal(await page.$$eval('[data-open-writer]',nodes=>nodes.length),writer?0:1);
   assert(headers.every(h=>h===(writer?'writer':'studio')));
   assert.equal(await page.$eval('#running-pill',el=>el.textContent),writer?'No active jobs':'1 active job');
   await page.click('[data-source="script"]');assert(await page.$eval('#import-script',el=>!el.classList.contains('hidden')));
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: full Studio and dedicated writer render correctly, route preferences separately, retain direct import and isolate writer job logs. Mock API/headless UI only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
