const assert=require('assert'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer');
(async()=>{
 const executablePath=process.env.PUPPETEER_EXECUTABLE_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
 const browser=await puppeteer.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage();let submitted=null;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',async req=>{
   const url=new URL(req.url());
   if(url.pathname.startsWith('/assets/'))return req.respond({status:200,contentType:url.pathname.endsWith('.js')?'text/javascript':'text/css',body:fs.readFileSync(path.join(__dirname,'../desktop_ui',path.basename(url.pathname)))});
   if(url.pathname==='/')return req.respond({status:200,contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../desktop_ui/index.html'),'utf8').replace('__SESSION_TOKEN__','test')});
   let data={};
   if(url.pathname==='/api/bootstrap')data={defaults:{story:'D:/one_story.json',project:'',aspect:'9:16',cdp:9222},globalWorkflow:{videoModel:'Omni 1.2 Flash',videoAspect:'9:16',videoResolution:'360p',videoDownloadVersion:'upscaled',videoSeconds:10,automationCdp:9222,agentPromptsPerBatch:5,rotateQueueAccounts:false},referenceLibrary:{root:'references',folders:{},modes:{agent:true,ingredients:true,omni:true}},presets:[{id:'3d-zack-style',name:'Zack Animation'}],models:['Omni 1.2 Flash'],preferences:{current:'agent',forms:{}},workflowDefaults:{agent:{},ingredients:{},omni:{}}};
   if(url.pathname==='/api/library')data=['one','two'].map(n=>({title:n,path:`D:/${n}_story.json`,presetId:'3d-zack-style',scenes:2,clipSeconds:10,duration:20,done:false}));
   if(url.pathname==='/api/accounts')data={accounts:[]};
   if(url.pathname==='/api/story')data={title:'Test',scenes:2,clipSeconds:10,duration:20};
   if(url.pathname==='/api/jobs'){
    if(req.method()==='POST'){submitted=JSON.parse(req.postData());data={id:'test',lane:'flow',status:'running'};}
    else data=[];
   }
   if(url.pathname==='/api/jobs/test')data={id:'test',lane:'flow',status:'running',cursor:0,logs:[]};
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://studio.local/');await page.waitForSelector('#audioFirstEnabled');
  assert.equal(await page.$eval('#audioFirstEnabled',e=>e.checked),false);
  await page.click('#audioFirstEnabled');
  await page.$$eval('[data-queue-story]',els=>els.forEach(e=>e.click()));
  await page.click('[data-action="generate_queue"]');await page.waitForSelector('#confirm-dialog[open]');
  assert((await page.$eval('#confirm-text',e=>e.textContent)).includes('external narration first'));
  await page.click('#confirm-yes');await page.waitForFunction(()=>document.querySelector('#log').textContent.includes('Starting'));
  assert(submitted&&submitted.action==='generate_queue'&&submitted.payload.queueAudioMode==='audio_first');
  assert.equal(submitted.payload.queue.length,2);assert.equal(submitted.payload.view,'agent');
  assert((await page.$eval('#audioFirstEnabled',e=>e.closest('section').querySelector('h2').textContent))==='References & finishing');
  assert.equal(await page.$$('button[data-action="prepare_audio_first"]').then(els=>els.length),0);
  await page.evaluate(()=>navigate('settings'));
  await page.waitForSelector('#audioFirstStory');
  assert.equal(await page.$$eval('#view-form > section.panel',els=>els[els.length-1].querySelector('h2').textContent),'Audio First — Single Story / Scene Test');
  assert.deepEqual(errors,[]);
  console.log('PASS: actual Studio batch UI defaults Native and submits two selected Audio First stories through the normal queue confirmation; no live APIs.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
