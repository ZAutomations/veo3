const assert=require('assert'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer');
(async()=>{
 const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
 const browser=await puppeteer.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage();let complete=false,saves=0;const errors=[];const id='a'.repeat(24);
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',async req=>{
   const url=new URL(req.url());
   if(url.pathname.startsWith('/assets/'))return req.respond({status:200,contentType:url.pathname.endsWith('.js')?'text/javascript':'text/css',body:fs.readFileSync(path.join(__dirname,'../desktop_ui',path.basename(url.pathname)))});
   if(url.pathname==='/')return req.respond({status:200,contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../desktop_ui/index.html'),'utf8').replace('__SESSION_TOKEN__','test')});
   let data={};
   if(url.pathname==='/api/bootstrap')data={defaults:{},presets:[],models:[],preferences:{current:'reverse',forms:{}},workflowDefaults:{}};
   if(url.pathname==='/api/accounts')data={accounts:[]};
   if(url.pathname==='/api/library')data=[];
   if(url.pathname==='/api/reverse-runs')data=[{id,name:'Fixture',complete}];
   if(url.pathname==='/api/reverse-run')data={id,complete,folder:'Fixture',files:complete?{'preset.json':'{"id":"reference-fixture","name":"Fixture"}','MASTER_PROMPT.txt':'Complete master prompt fixture.'}:{}};
   if(url.pathname==='/api/jobs')data=[{id:'job',action:'reverse_video',status:complete?'completed':'running',lane:'writer'}];
   if(url.pathname==='/api/jobs/job')data={id:'job',status:complete?'completed':'running',lane:'writer',cursor:0,logs:[]};
   if(url.pathname==='/api/reverse-save'){saves++;data={name:'Fixture'};}
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://studio.local/');
  await page.waitForFunction(()=>document.querySelector('#reverse-status')?.textContent.startsWith('Partial'));
  assert.equal(await page.$eval('#reverse-save',b=>b.disabled),true);
  complete=true;
  await page.waitForFunction(()=>document.querySelector('#reverse-save')?.disabled===false);
  assert.equal(await page.$eval('#reverse-master',b=>b.value),'Complete master prompt fixture.');
  await page.$eval('#reverse-master',el=>el.value='User reviewed and edited this.');
  await page.evaluate(()=>pollJobs());
  assert.equal(await page.$eval('#reverse-master',b=>b.value),'User reviewed and edited this.');
  assert.equal(saves,0,'Completion enables review/save; never auto-register a preset');
  assert.deepEqual(errors,[]);
  console.log('PASS: completed reverse analysis automatically enables Save and loads artifacts, later polls preserve edits, no preset saved automatically.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
