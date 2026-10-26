const assert=require('assert'),puppeteer=require('puppeteer');
const {clickDownloadOption}=require('../download_menu_click');
(async()=>{const browser=await puppeteer.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<div class="cdk-overlay-container"><button role="menuitem">1080p Upscaled</button></div>');await page.evaluate(()=>{window.trustedClicks=0;document.querySelector('button').onclick=e=>{if(e.isTrusted)window.trustedClicks++};});
await page.evaluate(()=>document.querySelector('button').click());assert.equal(await page.evaluate(()=>window.trustedClicks),0,'DOM click is not user activation');
await clickDownloadOption(page,'1080p Upscaled');assert.equal(await page.evaluate(()=>window.trustedClicks),1);
await page.evaluate(()=>{const cover=document.createElement('div');cover.style='position:fixed;inset:0;background:white;z-index:9999';document.body.append(cover)});
await assert.rejects(clickDownloadOption(page,'1080p Upscaled',{wait:async()=>{}}),/covered or moving/);assert.equal(await page.evaluate(()=>window.trustedClicks),1);
console.log('PASS: real Chrome receives a trusted final download click; DOM-only clicks and covered options cannot count as activation.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
