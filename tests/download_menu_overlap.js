const assert=require('assert'),puppeteer=require('puppeteer');
const bg=require('../single_clip_omni_background'),{menuItems}=require('../single_clip_omni_upscaled'),{clickDownloadOption}=require('../download_menu_click');
(async()=>{const browser=await puppeteer.launch({headless:true});try{
 const page=await browser.newPage();
 await page.setContent(`<style>.pane{position:absolute;left:20px;top:20px;background:white}button{width:200px;height:50px}</style><div class="cdk-overlay-container"><div class="pane" style="z-index:1"><button id="old" role="menuitem">download Download</button></div><div class="pane" style="z-index:2"><button id="active" role="menuitem">download Download</button></div><button role="menuitem" style="visibility:hidden">download Download</button></div>`);
 await page.evaluate(()=>{window.clicked=[];document.querySelectorAll('button').forEach(e=>e.onclick=()=>window.clicked.push(e.id));});
 assert.equal((await page.evaluate(menuItems)).length,1,'covered and visibility-hidden copies must not count');
 assert(await page.evaluate(bg.clickMenuText,'download Download'));
 assert.deepEqual(await page.evaluate(()=>window.clicked),['active']);
 await page.evaluate(()=>document.querySelectorAll('button').forEach(e=>e.textContent='1080p Upscaled'));
 await clickDownloadOption(page,'1080p Upscaled');
 assert.deepEqual(await page.evaluate(()=>window.clicked),['active','active']);
 await page.setContent('<div class="cdk-overlay-backdrop" id="old" style="position:fixed;inset:0"></div><div class="cdk-overlay-backdrop" id="top" style="position:fixed;inset:0"></div>');
 await page.evaluate(()=>{window.dismissedBackdrops=[];document.querySelectorAll('div').forEach(e=>e.onclick=()=>{window.dismissedBackdrops.push(e.id);e.remove();});});
 assert(await page.evaluate(bg.closeMenus));assert.deepEqual(await page.evaluate(()=>window.dismissedBackdrops),['top']);
 console.log('PASS: overlapping stale/hidden menus do not create duplicate Download or Upscaled choices; active menu receives trusted click; top backdrop closes first.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
