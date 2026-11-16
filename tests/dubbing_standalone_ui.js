const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

(async () => {
 const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(file => fs.existsSync(file));
 const browser = await puppeteer.launch({headless:true, executablePath});
 try {
  const page = await browser.newPage();
  const errors = [];
  const requests = new Map();
  const ui = path.join(__dirname, '../desktop_ui');
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
   const route = new URL(request.url()).pathname;
   if (route === '/') return request.respond({contentType:'text/html', body:fs.readFileSync(path.join(ui,'index.html'),'utf8')});
   if (route.startsWith('/assets/')) {
    const file = path.join(ui,path.basename(route));
    if (!fs.existsSync(file)) return request.respond({status:404});
    return request.respond({contentType:route.endsWith('.js')?'text/javascript':'text/css', body:fs.readFileSync(file)});
   }
   requests.set(route, {surface:request.headers()['x-studio-surface'], body:JSON.parse(request.postData()||'null')});
   const dubbing = {id:'dub', lane:'dubbing', status:'running', action:'render_local_multilingual', cursor:0, logs:[]};
   const data = {
    '/api/bootstrap': {root:'Fixture', preferences:{current:'agent'}, workflowDefaults:{}, multilingual:{enabled:true,languages:[{code:'ur',provider:'google',voice:'Orus'}]}},
    '/api/video-editing': {schema:[],settings:{}},
    '/api/jobs': [{id:'flow',lane:'flow',status:'running'}, dubbing],
    '/api/jobs/dub': dubbing,
    '/api/retry': dubbing,
    '/api/local-dubbing/plan': {jobs:[{title:'Fixture story',pending:['ur'],missing_voices:[]}]},
    '/api/library': [], '/api/accounts': {accounts:[]},
   }[route] || {};
   return request.respond({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.setViewport({width:980,height:620});
  page.setDefaultTimeout(8000);
  await page.goto('http://studio.local/?dubbing=1');
  await page.waitForSelector('#local-dub-scan');
  assert.equal(await page.title(),'VEO3 Dubbing');
  assert.deepEqual(await page.$$eval('#navigation button', rows=>rows.map(row=>row.textContent)), ['Dubbing']);
  assert.equal(await page.$('#save-audio-settings'),null);
  assert.equal(await page.$eval('#multiVoice_ur',field=>field.value),'Orus');
  await page.waitForFunction(()=>document.querySelector('#job-picker').value==='dub');
  assert.deepEqual(await page.$$eval('#job-picker option', rows=>rows.map(row=>row.value)),['dub']);
  await page.$eval('#local-dub-scan', button => button.scrollIntoView({block:'center'}));
  await page.click('#local-dub-scan');
  await page.waitForFunction(()=>document.querySelector('#local-dub-plan').textContent.includes('Fixture story'));
  assert.equal(requests.get('/api/local-dubbing/plan').surface,'dubbing');
  assert.equal(requests.get('/api/local-dubbing/plan').body.localDubFolder,'Fixture/stories');
  await page.click('[data-action="retry"]');
  await page.waitForFunction(()=>document.querySelector('#activity').classList.contains('expanded'));
  assert.deepEqual(requests.get('/api/retry').body,{view:'dubbing'});
  assert.deepEqual(errors,[]);
  console.log('PASS: standalone dubbing controls, settings, scan, isolated job list and retry.');
 } finally {
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exit(1);});
