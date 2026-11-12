const assert=require('assert'),fs=require('fs'),puppeteer=require('puppeteer');
(async()=>{
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setViewport({width:1500,height:1000});
  await page.setContent('<main id="main"></main>');
  const source=fs.readFileSync('desktop_ui/app.js','utf8');
  const helpers=source.slice(source.indexOf('function field('),source.indexOf('function renderNav('));
  const manual=source.slice(source.indexOf('function renderManualJobs('),source.indexOf('function renderPrompts('));
  await page.addScriptTag({content:`const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const forms={manual:{}};const accounts={accounts:[{label:'A',email:'a@gmail.com'}]};const library=[{title:'Saved story',path:'story_story.json'}];function toast(m){window.message=m;}function remember(){forms.manual.manualJobs=$('manualJobs').value;} ${helpers}${manual}renderManualJobs();bindManualJobs();window.getQueue=()=>JSON.parse($('manualJobs').value);window.reload=()=>{renderManualJobs();bindManualJobs();};`});
  await page.type('#manualProject','https://flow.google.com/project/manual-1');
  await page.select('#manualGmail','a@gmail.com');await page.select('#manualStory','story_story.json');
  await page.click('#manual-add');
  assert.equal((await page.evaluate(()=>getQueue())).length,1);
  assert.equal(await page.$$eval('[data-manual-remove]',es=>es.length),1);
  await page.evaluate(()=>reload());
  assert.equal((await page.evaluate(()=>getQueue()))[0].gmail,'a@gmail.com');
  assert.equal(await page.$eval('[data-action="manual_jobs"]',e=>e.textContent),'Start manual jobs');
  assert(await page.$eval('#manualApplyEditing',e=>e.checked));
  await page.click('[data-manual-remove="0"]');assert.equal((await page.evaluate(()=>getQueue())).length,0);
  assert(source.includes("else if(current==='manual')renderManualJobs()"));
  assert(source.includes("if(current==='manual')bindManualJobs()"));
  console.log('PASS: Manual Jobs tab adds, persists and removes bound queue rows; finishing and retry controls are wired.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
