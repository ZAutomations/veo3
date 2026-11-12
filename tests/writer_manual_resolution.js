'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),puppeteer=require('puppeteer');
(async()=>{
 const source=fs.readFileSync('desktop_ui/app.js','utf8'),main={innerHTML:''};
 const ctx={$:()=>main,esc:s=>String(s??''),writerOnly:false,bootstrap:{defaults:{preset:'3d-zack-style',transport:'web',aspect:'9:16',geminiModel:''},presets:[{id:'3d-zack-style',name:'3D Zack style'}]}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function field('),source.indexOf('function renderNav(')),ctx);
 vm.runInContext(source.slice(source.indexOf('function renderWriter('),source.indexOf('function updateWriterDuration(')),ctx);
 ctx.renderWriter();
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setViewport({width:1600,height:1000});
  const css=['style.css','compact_layout.css'].map(f=>fs.readFileSync('desktop_ui/'+f,'utf8')).join('\n');
  await page.setContent('<style>'+css+'</style><main>'+main.innerHTML+'</main>');
  await page.addScriptTag({path:'desktop_ui/compact_layout.js'});
  await page.evaluate(()=>StudioCompactLayout.apply(document.querySelector('main'),'writer'));
  assert.deepEqual(await page.$$eval('#manualResolution option',es=>es.map(e=>e.value)),['360p','720p','1080p']);
  const layout=await page.evaluate(()=>{const grid=document.querySelector('#writer-production-controls'),card=grid.closest('.panel');return {full:card.classList.contains('studio-span-full'),rows:[...new Set([...grid.querySelectorAll('input,select')].map(e=>Math.round(e.getBoundingClientRect().top)))],overflow:grid.scrollWidth>grid.clientWidth};});
  assert(layout.full);assert.equal(layout.rows.length,1,'desktop writer settings should share one compact row');assert(!layout.overflow);
  await page.setViewport({width:700,height:1000});
  assert(await page.$eval('#writer-production-controls',e=>e.scrollWidth<=e.clientWidth),'narrow controls must wrap rather than overflow');
 }finally{await browser.close();}
 console.log('PASS: Make it yours offers 360/720/1080 manual resolution; seven controls form one desktop row and wrap without overflow.');
})().catch(e=>{console.error(e);process.exitCode=1;});
