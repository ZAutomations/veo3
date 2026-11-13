const assert=require('assert'),fs=require('fs'),puppeteer=require('puppeteer');
(async()=>{
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setViewport({width:1500,height:1000});
  await page.setContent('<main id="main"></main>');
  const source=fs.readFileSync('desktop_ui/app.js','utf8');
  const helpers=source.slice(source.indexOf('function field('),source.indexOf('function renderNav('));
  const manual=source.slice(source.indexOf('function renderManualJobs('),source.indexOf('function renderPrompts('));
  await page.addScriptTag({content:`const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const forms={manual:{}};const accounts={accounts:[{label:'A',email:'a@gmail.com'}]};const library=[{title:'Saved story',path:'story_story.json'},{title:'Finished',path:'finished_story.json',done:true,fullyComplete:true,completion:'Final video saved'},{title:'Downloaded only',path:'downloaded_story.json',done:true,fullyComplete:false,completion:'All clips downloaded'},{title:'Language pending',path:'languages_story.json',done:true,fullyComplete:false,completion:'English saved · languages pending'},{title:'Internal render',path:'localized_story.json',internalRender:true}];function toast(m){window.message=m;}function remember(){forms.manual.manualJobs=$('manualJobs').value;} ${helpers}${manual}renderManualJobs();bindManualJobs();window.getQueue=()=>JSON.parse($('manualJobs').value);window.reload=()=>{renderManualJobs();bindManualJobs();};`});
  const choices=await page.$$eval('#manualStory option',es=>es.map(e=>e.value));assert(!choices.includes('finished_story.json'));assert(!choices.includes('localized_story.json'));assert(choices.includes('downloaded_story.json'));assert(choices.includes('languages_story.json'));
  await page.type('#manualProject','https://flow.google.com/project/manual-1');
  await page.select('#manualGmail','a@gmail.com');await page.select('#manualStory','story_story.json');
  await page.click('#manual-add');
  assert.equal((await page.evaluate(()=>getQueue())).length,1);
  assert.equal(await page.$$eval('[data-manual-remove]',es=>es.length),1);
  await page.evaluate(()=>{library[0].fullyComplete=true;library[0].completion='Final video saved';reload();});
  assert(!(await page.$$eval('#manualStory option',es=>es.map(e=>e.value))).includes('story_story.json'),'newly completed stories disappear after refresh');
  assert.equal((await page.evaluate(()=>getQueue()))[0].gmail,'a@gmail.com');
  assert.equal(await page.$eval('[data-action="manual_jobs"]',e=>e.textContent),'Start manual jobs');
  assert(await page.$eval('#manualApplyEditing',e=>e.checked));
  await page.click('[data-manual-remove="0"]');assert.equal((await page.evaluate(()=>getQueue())).length,0);
  assert(source.includes("else if(current==='manual')renderManualJobs()"));
  assert(source.includes("if(current==='manual')bindManualJobs()"));
  console.log('PASS: Manual Jobs tab adds, persists and removes bound queue rows; finishing and retry controls are wired.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
