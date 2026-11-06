'use strict';
const assert=require('assert'),puppeteer=require('puppeteer'),MT=require('../mention_target'),S=require('../reference_submit');
(async()=>{
 const name='Ukraine; Kyiv; Vinnytsia; Dnipropetrovsk; Zhytomyr; Zaporizhzhia; Kharkiv; Chernihiv';
 const longer=name+'; additional verified map region and design reference';
 for(const n of [name,longer]){
  const candidate={text:(n+' Image').slice(0,100),assetName:n,kind:'image',depth:4,rect:{x:1,y:1,w:100,h:100}};
  assert.equal(MT.chooseMentionTile([candidate],n,{requiredKind:'image'}).inner,candidate);
  assert.equal(MT.chooseMentionTile([candidate],n+' other',{requiredKind:'image'}).inner,null,'a truncated prefix must not substitute another asset');
  assert.equal(MT.chooseMentionTile([candidate],n,{requiredKind:'character'}).inner,null,'Images and Characters remain separate');
 }
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<button aria-label="Start generation" style="display:none">Hidden copy</button><div class="ProseMirror" contenteditable="true">Reference image prompt</div><button id="submit" aria-label="Start generation" style="position:absolute;left:200px;top:100px">Generate</button><div id="cover" style="position:fixed;inset:0;background:#aaa;z-index:999"></div>');
  await page.evaluate(()=>{
   window.sent=0;const button=document.querySelector('#submit'),editor=document.querySelector('.ProseMirror');
   button.onclick=e=>{if(e.isTrusted)window.sent++;};
   editor.onblur=()=>{button.disabled=true;setTimeout(()=>{button.disabled=false;document.querySelector('#cover').remove();},200);};
   editor.focus();
  });
  assert((await S.clickSubmit(page)).ok);assert.equal(await page.evaluate(()=>window.sent),1,'first submission must target the visible uncovered button after editor commit');
  await page.evaluate(()=>{const cover=document.createElement('div');cover.id='block';cover.style='position:fixed;inset:0;z-index:999';document.body.append(cover);});
  assert(!(await S.clickSubmit(page,{timeout:250})).ok);assert.equal(await page.evaluate(()=>window.sent),1,'covered button must not receive a blind click');
 }finally{await browser.close();}
 console.log('PASS: exact long asset titles, type isolation, hidden submit duplicates, editor blur/readiness and covered-button protection. Headless fixture only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
