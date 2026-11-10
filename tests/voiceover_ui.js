const assert=require('assert'),path=require('path'),{execFileSync}=require('child_process'),puppeteer=require('puppeteer');
(async()=>{
 const fixture=JSON.parse(execFileSync('python',['-c','import json,video_editing as e; print(json.dumps(dict(settings=e.defaults(),schema=e.schema(),presets=[],fonts=[],sfx=[])))'],{cwd:path.join(__dirname,'..'),encoding:'utf8'}));
 const executablePath=process.env.PUPPETEER_EXECUTABLE_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>require('fs').existsSync(p));
 const browser=await puppeteer.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage();await page.setContent('<main id="main"></main>');
  await page.evaluate(data=>{
   window.fixture=data;window.$=id=>document.getElementById(id);window.esc=x=>String(x??'').replace(/"/g,'&quot;');
   window.current='editing';window.preferences={};window.library=[];
   window.heading=()=>'';window.panel=(title,sub,n,body)=>`<section><h2>${title}</h2>${body}</section>`;
   window.field=(label,id,value,opts={})=>opts.items?`<select id="${id}">${opts.items.map(v=>`<option value="${v.id??v}">${v.name??v}</option>`).join('')}</select>`:`<input id="${id}" value="${value}">`;
   window.toggle=(id,label,value)=>`<input id="${id}" type="checkbox" ${value?'checked':''}>`;
   window.api=async()=>window.fixture;window.restore=()=>{};window.setupCardVisibility=()=>{};window.remember=()=>{};
  },fixture);
  await page.addScriptTag({path:path.join(__dirname,'../desktop_ui/video_editing.js')});
  await page.evaluate(()=>renderVideoEditing());
  assert.equal(await page.$eval('#edit-voiceover_mode',el=>el.value),'native');
  assert.equal(await page.$$eval('#edit-voiceover_mode option',els=>els.length),3);
  assert.deepEqual(await page.$$eval('#edit-voiceover_provider option',els=>els.map(e=>e.value)),['elevenlabs','heygen','ai33pro']);
  assert.equal(await page.$eval('#voiceover-key',el=>el.type),'password');
  await page.select('#edit-voiceover_mode','local');
  assert.equal(await page.evaluate(()=>collectEditing().voiceover_mode),'local');
  await page.evaluate(()=>{window.api=async(route,cfg)=>route==='video-editing/settings'?({settings:cfg}):({voices:[{voice_id:'heygen-test-id',name:'Test Narrator',gender:'male'}]});});
  await page.select('#edit-voiceover_mode','api');
  await page.select('#edit-voiceover_provider','heygen');
  await page.waitForFunction(()=>document.querySelectorAll('#voiceover-voices option').length===1);
  assert.equal(await page.$eval('#edit-voiceover_voice',el=>el.getAttribute('list')),'voiceover-voices');
  await page.$eval('#edit-voiceover_voice',el=>el.value='heygen-test-id');
  await page.select('#edit-voiceover_provider','elevenlabs');
  await page.select('#edit-voiceover_provider','heygen');
  assert.equal(await page.$eval('#edit-voiceover_voice',el=>el.value),'heygen-test-id');
  const saved=await page.evaluate(()=>collectEditing());
  assert.equal(saved.voiceover_saved_voices.heygen,'heygen-test-id');
  await page.evaluate(cfg=>{window.fixture.settings=cfg;window.api=async()=>window.fixture;},saved);
  await page.evaluate(()=>renderVideoEditing());
  assert.equal(await page.$eval('#edit-voiceover_voice',el=>el.value),'heygen-test-id');
  await page.evaluate(()=>{window.api=async(route,cfg)=>({settings:cfg});});
  await page.click('#external-voiceover-enabled');
  assert.equal(await page.evaluate(()=>collectEditing().voiceover_mode),'native');
  assert.equal(await page.$eval('#edit-voiceover_voice',el=>el.value),'heygen-test-id');
  console.log('PASS: editing voiceover panel renders, Native default, all three providers, password field and local mode collection.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
