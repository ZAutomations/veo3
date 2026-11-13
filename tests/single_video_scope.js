const assert=require('assert'),puppeteer=require('puppeteer'),media=require('../single_clip_omni_media');
(async()=>{
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage();
  const sceneId='V3_779bb6879af0_S001';
  await page.setContent(`<mat-sidenav-content><div class="grid-area-wrapper"><div class="virtual-scroll-container"><div class="tile-row"><flow-grid-tile-container><flow-video-tile><span>play_circle</span><img src="https://flow.google.com/asb/real-video"><span class="asset-title">A generic video title</span></flow-video-tile></flow-grid-tile-container></div></div></div><div class="messages-list">Instructions: content policy, prompt might violate, generation failed. SCENE ASSET ID: ${sceneId}</div><div contenteditable="true">generating</div></mat-sidenav-content>`);
  let tiles=await media.snapshot(page);
  assert.equal(tiles.length,1);assert(tiles[0].ready);assert(!tiles[0].failed);assert(!tiles[0].busy);
  assert(!tiles[0].text.includes('content policy'));
  assert(!media.promptMatches(tiles[0],{number:1,sceneId}),'chat scene ID must not prove ownership of an unrelated generic video');
  await page.$eval('flow-video-tile',(el,id)=>el.insertAdjacentHTML('beforeend',`<div>SCENE ASSET ID: ${id}</div>`),sceneId);
  tiles=await media.snapshot(page);assert(media.promptMatches(tiles[0],{number:1,sceneId}));
  await page.$eval('flow-video-tile',el=>el.insertAdjacentHTML('beforeend','<div class="generation-error">Generation failed</div>'));
  tiles=await media.snapshot(page);assert(tiles[0].failed);assert(!tiles[0].ready,'genuine card-local errors still block completion');
  // List layouts may keep the status beside the preview; retain that row.
  await page.setContent('<main><section class="asset-row"><flow-video-tile><img src="https://flow.google.com/asb/list-video"></flow-video-tile><div class="generation-error">Generation failed</div></section><div contenteditable="true">prompt</div></main>');
  tiles=await media.snapshot(page);assert(tiles[0].failed);
  console.log('PASS: one-video projects exclude chat/composer policy text and IDs; real asset-row errors remain visible.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
