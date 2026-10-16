const assert=require('assert'),path=require('path'),fs=require('fs'),puppeteer=require('puppeteer');
(async()=>{
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent(`<main><form><section class="panel"><div class="panel-title"><h2>Video settings</h2></div><input name="model" value="Omni Flash"><input type="checkbox" checked><button type="button" id="action">Generate</button></section><details open><summary>Saved stories</summary><div class="panel"><input name="story" value="My story"></div></details><div class="table-wrap"><table><tr><td>Story</td></tr></table></div></form></main>`);
  await page.addStyleTag({path:path.join(__dirname,'../desktop_ui/theme.css')});
  await page.addScriptTag({path:path.join(__dirname,'../desktop_ui/card_visibility.js')});
  await page.evaluate(()=>{window.states={};window.changes=0;window.install=()=>StudioCardVisibility.install(document.querySelector('main'),{view:'omni',states,onChange:()=>changes++});install();});
  assert.equal(await page.$$eval('.card-visibility-toggle',nodes=>nodes.length),3,'nested panels use their parent details control');
  const before=await page.$eval('section',el=>el.getBoundingClientRect().height);
  await page.click('section .card-visibility-toggle');
  assert(await page.$eval('section .card-body',el=>el.hidden));
  assert((await page.$eval('section',el=>el.getBoundingClientRect().height))<before);
  assert.equal(await page.$eval('[name=model]',el=>el.value),'Omni Flash');
  assert(await page.$eval('[type=checkbox]',el=>el.checked));
  assert.equal(await page.$eval('section .card-visibility-toggle',el=>el.getAttribute('aria-expanded')),'false');
  assert.deepEqual(await page.$eval('form',el=>Object.fromEntries(new FormData(el))),{model:'Omni Flash',story:'My story'});
  await page.click('section .card-visibility-toggle');assert(!(await page.$eval('section .card-body',el=>el.hidden)));
  await page.click('details .card-visibility-toggle');assert(!(await page.$eval('details',el=>el.open)));
  await page.click('summary');assert(await page.$eval('details',el=>el.open));
  await page.click('section .card-visibility-toggle');
  await page.evaluate(()=>{window.snapshot=document.querySelector('main').innerHTML;document.querySelector('main').innerHTML='<section class="panel"><div class="panel-title"><h2>Video settings</h2></div><input value="Still here"></section>';install();});
  assert(await page.$eval('section .card-body',el=>el.hidden),'remembered state restores on newly rendered cards');
  await page.evaluate(()=>{StudioCardVisibility.install(document.querySelector('main'),{view:'agent',states,onChange:()=>{}});});
  assert.equal(await page.$$eval('.card-visibility-toggle',nodes=>nodes.length),1,'repeated setup is idempotent');
  assert((await page.evaluate(()=>changes))>=4);
  console.log('PASS: Show/Hide saves state, reduces card height, retains form values and selections, respects nested details and is idempotent. Local headless browser only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
