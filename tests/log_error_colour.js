const assert=require('assert'),fs=require('fs'),puppeteer=require('puppeteer');
const {isError}=require('../desktop_ui/log_view');
for(const line of ['[09:26:50] FAILED at run_agent: Waiting for selector failed','RECOVERY_REVIEW_REQUIRED: Scene 1 has no unique ready source','DOWNLOAD FAILED: no transfer','TypeError: browser is not defined','Traceback (most recent call last):','[mcp] Driver exited with code 2','Done: 0 ok, 1 failed, of 1 attempted.','ready=0, failed=1','  at main (D:/tool/agent.js:88:3)','[09:00] FAILED','this prompt might violate our policies'])assert(isError(line),line);
for(const line of ['Starting agent_mode.js','Workflow completed successfully.','Done: 1 ok, 0 failed, of 1 attempted.','ready=1, failed=0, generating=0','exit 0 after 6s','No errors','SAFE RETRY: FAILED MEDIA TILES ONLY','3 reference images attached'])assert(!isError(line),line);
(async()=>{
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<pre id="log" style="height:90px;overflow:auto;white-space:pre-wrap"></pre>');
  await page.addStyleTag({content:fs.readFileSync('desktop_ui/theme.css','utf8')});
  await page.addScriptTag({content:fs.readFileSync('desktop_ui/log_view.js','utf8')});
  await page.evaluate(()=>{
   window.view=StudioLogView.create(document.getElementById('log'));
   view.append(['Starting job','FAILED: <img src=x onerror="window.injected=true">','Workflow completed successfully.']);
  });
  assert.equal(await page.$eval('#log .log-error',e=>getComputedStyle(e).color),'rgb(255, 107, 114)');
  assert.equal(await page.$$eval('#log img',es=>es.length),0,'log text must never execute HTML');
  assert.equal(await page.$eval('#log',e=>e.textContent),'Starting job\nFAILED: <img src=x onerror="window.injected=true">\nWorkflow completed successfully.');
  await page.evaluate(()=>{const node=document.getElementById('log').firstChild;window.originalNode=node;const range=document.createRange();range.selectNodeContents(node);const s=getSelection();s.removeAllRanges();s.addRange(range);view.append(['RECOVERY_REVIEW_REQUIRED: inspect scene']);});
  assert(await page.evaluate(()=>document.getElementById('log').firstChild===window.originalNode&&getSelection().toString()==='Starting job\n'));
  await page.evaluate(()=>{view.pause(true);view.append(['TypeError: paused error']);});
  assert.equal(await page.$$eval('#log .log-error',es=>es.length),2);
  await page.evaluate(()=>view.pause(false));assert.equal(await page.$$eval('#log .log-error',es=>es.length),3);
  console.log('PASS: error lines render red, success/zero-failure lines stay normal, HTML is inert, and selection/pause/plain-text copying are preserved.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
