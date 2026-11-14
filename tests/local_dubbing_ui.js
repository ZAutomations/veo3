const assert=require('assert'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer');
(async()=>{
 const executablePath=process.env.PUPPETEER_EXECUTABLE_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
 const browser=await puppeteer.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage();await page.setViewport({width:1600,height:1000});let submitted=null,scan=null,savedAudio=null,savedLanguages=null;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',async req=>{
   const url=new URL(req.url());
   if(url.pathname.startsWith('/assets/'))return req.respond({status:200,contentType:url.pathname.endsWith('.js')?'text/javascript':'text/css',body:fs.readFileSync(path.join(__dirname,'../desktop_ui',path.basename(url.pathname)))});
   if(url.pathname==='/')return req.respond({status:200,contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../desktop_ui/index.html'),'utf8').replace('__SESSION_TOKEN__','test')});
   let data={};
   if(url.pathname==='/api/bootstrap')data={defaults:{story:'D:/one_story.json',project:'',aspect:'9:16',cdp:9222},globalWorkflow:{videoModel:'Omni 1.2 Flash',videoAspect:'9:16',videoResolution:'360p',videoDownloadVersion:'upscaled',videoSeconds:10,automationCdp:9222,agentPromptsPerBatch:5,rotateQueueAccounts:false},referenceLibrary:{root:'references',folders:{},modes:{agent:true,ingredients:true,omni:true}},presets:[{id:'3d-zack-style',name:'Zack Animation'}],models:['Omni 1.2 Flash'],preferences:{current:'audio',forms:{}},workflowDefaults:{agent:{},ingredients:{},omni:{}}};
   if(url.pathname==='/api/video-editing')data=JSON.parse(fs.readFileSync(path.join(__dirname,'audio_settings_fixture.json'),'utf8'));
   if(url.pathname==='/api/library')data=['one','two'].map(n=>({title:n,path:`D:/${n}_story.json`,presetId:'3d-zack-style',scenes:2,clipSeconds:10,duration:20,done:false}));
   if(url.pathname==='/api/video-editing/settings'){savedAudio=JSON.parse(req.postData());data={settings:savedAudio};}
   if(url.pathname==='/api/settings'){savedLanguages=JSON.parse(req.postData());data={ok:true};}
   if(url.pathname==='/api/voiceover/configure')data={voices:[{voice_id:'Alnilam',name:'Alnilam'}],service_account:'D:/private/service.json'};
   if(url.pathname==='/api/voiceover/preview')data={file:'0123456789abcdef0123456789abcdef.wav'};
   if(url.pathname.startsWith('/api/voiceover/audio/'))return req.respond({status:200,contentType:'audio/wav',body:Buffer.from('RIFFtest')});
   if(url.pathname==='/api/accounts')data={accounts:[]};
   if(url.pathname==='/api/story')data={title:'Test',scenes:2,clipSeconds:10,duration:20};
   if(url.pathname==='/api/jobs'){
    if(req.method()==='POST'){submitted=JSON.parse(req.postData());data={id:'test',lane:'flow',status:'running'};}
    else data=[];
   }
   if(url.pathname==='/api/local-dubbing/plan'){scan=JSON.parse(req.postData());data={count:1,jobs:[{title:'Local Fixture',clean_background:false}],note:'No generation'};}
   if(url.pathname==='/api/jobs/test')data={id:'test',lane:'flow',status:'running',cursor:0,logs:[]};
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://studio.local/');await page.waitForSelector('#multilingualEnabled');
  assert.equal(await page.$eval('#multilingualEnabled',e=>e.checked),false);
  assert.equal(await page.$eval('#multilingualMode',e=>e.value),'english');assert(await page.$eval('#multiLang_ja',e=>e.disabled));
  await page.select('#multilingualMode','multiple');await page.click('#multiLang_ur');await page.select('#multiProvider_ur','google');await page.select('#multiVoice_ur','Alnilam');await page.type('#localDubFolder','D:/translated_scripts');await page.$eval('#local-dub-scan',e=>e.click());await page.waitForFunction(()=>document.querySelector('#local-dub-plan').textContent.includes('Local Fixture'));assert(scan&&scan.localDubFolder==='D:/translated_scripts');
  await page.click('[data-action="render_local_multilingual"]');
  await page.waitForFunction(()=>document.querySelector('#confirm-dialog')?.open||document.querySelector('dialog')?.open,{timeout:1000}).catch(()=>{});
  if(await page.$eval('#confirm-yes',e=>!!e.closest('dialog')?.open))await page.click('#confirm-yes');
  for(let i=0;i<30&&!submitted;i++)await new Promise(r=>setTimeout(r,100));
  assert(submitted,'Local dub button must submit an actual job');assert.equal(submitted.action,'render_local_multilingual');assert.equal(submitted.payload.localDubFolder,'D:/translated_scripts');assert.equal(submitted.payload.multiProvider_ur,'google');assert.equal(submitted.payload.multiVoice_ur,'Alnilam');assert.equal(submitted.payload.multilingualEnabled,true);
  await page.select('#multilingualMode','english');assert.equal(await page.$eval('#multilingualEnabled',e=>e.checked),false);assert(await page.$eval('[data-action="render_local_multilingual"]',e=>e.disabled));
  await page.select('#edit-voiceover_provider','google');assert.equal(await page.$$eval('#edit-voiceover_voice option',e=>e.length),30);assert.equal(await page.$$eval('#multiVoice_ur option',e=>e.length),30);await page.$eval('#edit-voiceover_voice',e=>e.value='Alnilam');
  await page.select('#edit-voiceover_voice','Kore');await page.$eval('#voice-preview-generate',e=>e.click());await page.waitForFunction(()=>!document.querySelector('#voice-preview-save').disabled);assert(await page.$eval('#voice-preview-status',e=>e.textContent.includes('Kore')));await page.select('#edit-voiceover_voice','Alnilam');
  await page.$eval('#save-audio-settings',e=>e.click());await page.waitForFunction(()=>document.querySelector('#editing-save-status').textContent==='Audio settings saved.');
  assert(savedAudio&&savedAudio.voiceover_provider==='google');assert.equal(savedAudio.voiceover_voice,'Alnilam');assert.equal(savedLanguages.multilingualEnabled,false);assert(!('referenceFolders' in savedLanguages));assert(!('voiceover-key' in savedLanguages));
  assert.equal(await page.$eval('#view-form',e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),4);
  await page.screenshot({path:'outputs/audio_settings_review.png',fullPage:true});
  await page.evaluate(()=>navigate('editing'));await page.waitForSelector('#save-video-editing');assert.equal(await page.$('#external-voiceover-enabled'),null);assert.equal(await page.$('#multilingualMode'),null);
  await page.evaluate(()=>navigate('settings'));await page.waitForSelector('#save-shared');assert.equal(await page.$('#heygen-preview'),null);
  await page.evaluate(()=>navigate('audio'));await page.waitForSelector('#save-audio-settings');assert.equal(await page.$eval('#edit-voiceover_voice',e=>e.value),'Alnilam');
  assert.deepEqual(errors,[]);console.log('PASS: actual local dubbing card scans scripts and submits selected-language-only job with Google voice; English-only disables run; no live APIs.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
