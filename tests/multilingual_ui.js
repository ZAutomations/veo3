const assert=require('assert'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer');
(async()=>{
 const executablePath=process.env.PUPPETEER_EXECUTABLE_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
 const browser=await puppeteer.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage();await page.setViewport({width:1600,height:1000});let submitted=null;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',async req=>{
   const url=new URL(req.url());
   if(url.pathname.startsWith('/assets/'))return req.respond({status:200,contentType:url.pathname.endsWith('.js')?'text/javascript':'text/css',body:fs.readFileSync(path.join(__dirname,'../desktop_ui',path.basename(url.pathname)))});
   if(url.pathname==='/')return req.respond({status:200,contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../desktop_ui/index.html'),'utf8').replace('__SESSION_TOKEN__','test')});
   let data={};
   if(url.pathname==='/api/bootstrap')data={defaults:{story:'D:/one_story.json',project:'',aspect:'9:16',cdp:9222},globalWorkflow:{videoModel:'Omni 1.2 Flash',videoAspect:'9:16',videoResolution:'360p',videoDownloadVersion:'upscaled',videoSeconds:10,automationCdp:9222,agentPromptsPerBatch:5,rotateQueueAccounts:false},referenceLibrary:{root:'references',folders:{},modes:{agent:true,ingredients:true,omni:true}},presets:[{id:'3d-zack-style',name:'Zack Animation'}],models:['Omni 1.2 Flash'],preferences:{current:'audio',forms:{}},workflowDefaults:{agent:{},ingredients:{},omni:{}}};
   if(url.pathname==='/api/video-editing')data=JSON.parse(fs.readFileSync(path.join(__dirname,'audio_settings_fixture.json'),'utf8'));
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
  await page.goto('http://studio.local/');await page.waitForSelector('#multilingualEnabled');
  assert.equal(await page.$eval('#multilingualEnabled',e=>e.checked),false);
  assert.equal(await page.$eval('#multilingualMode',e=>e.value),'english');assert(await page.$eval('#multiLang_ja',e=>e.disabled));
  await page.select('#multilingualMode','multiple');assert(!(await page.$eval('#multiLang_ja',e=>e.disabled)));await page.click('#multiLang_ru');await page.type('#multiVoice_ru','russian-voice');await page.type('#multilingualStory','D:/english_audio_first_story.json');
  await page.click('[data-action="render_multilingual"]');
  await page.waitForFunction(()=>document.querySelector('#confirm-dialog')?.open||document.querySelector('dialog')?.open,{timeout:1000}).catch(()=>{});
  if(await page.$eval('#confirm-yes',e=>!!e.closest('dialog')?.open))await page.click('#confirm-yes');
  for(let i=0;i<30&&!submitted;i++)await new Promise(r=>setTimeout(r,100));
  assert(submitted,'Multilingual button must submit an actual job');assert.equal(submitted.action,'render_multilingual');assert.equal(submitted.payload.story,'D:/english_audio_first_story.json');assert.equal(submitted.payload.multiVoice_ru,'russian-voice');assert.equal(submitted.payload.multiLang_ru,true);assert.equal(submitted.payload.multilingualEnabled,true);
  await page.select('#multilingualMode','english');assert.equal(await page.$eval('#multilingualEnabled',e=>e.checked),false);assert(await page.$eval('[data-action="render_multilingual"]',e=>e.disabled));
  assert.deepEqual(errors,[]);console.log('PASS: actual Studio optional language UI selects a provider/voice and submits the selected English package; no live APIs.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
