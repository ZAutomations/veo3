'use strict';
const fs=require('fs'),path=require('path');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function imageExtension(buf){
 if(buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return '.png';
 if(buf[0]===0xff&&buf[1]===0xd8)return '.jpg';
 if(buf.subarray(0,4).toString()==='RIFF'&&buf.subarray(8,12).toString()==='WEBP')return '.webp';
 return '';
}

async function downloadThumbnail(page,tile,targetDir,log=()=>{},settleMs=2500){
 if(!tile)throw Error('No Flow image tile named Thumbnail was found.');
 const dlDir=path.join(targetDir,'.thumbnail_browser_downloads');
 fs.mkdirSync(dlDir,{recursive:true});
 const cdp=await page.createCDPSession();
 try{await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dlDir,eventsEnabled:true});}
 catch(e){await cdp.detach().catch(()=>{});throw Error(`Could not set a private browser download folder for the thumbnail: ${e.message}`);}
 try{
 const sel='flow-image-tile, flow-video-tile, [class*=image-tile], [class*=video-tile]';
 const point=await page.evaluate(({sel,id,y,x})=>{
  const scroller=window.__veoGridScroller?.()||null;
  if(scroller)scroller.scrollTop=Math.max(0,y-scroller.clientHeight/2);
  else window.scrollTo(0,Math.max(0,y-window.innerHeight/2));
  const tiles=[...document.querySelectorAll(sel)].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;});
  const hit=tiles.find(el=>[...el.querySelectorAll('img,video,source')].some(m=>((m.currentSrc||m.getAttribute('src')||'').match(/\/(?:image|video|asb)\/([^=?/#]+)/)||[])[1]===id))
   ||tiles.sort((a,b)=>{const aa=a.getBoundingClientRect(),bb=b.getBoundingClientRect();return Math.abs(aa.y-y)+Math.abs(aa.x-x)-Math.abs(bb.y-y)-Math.abs(bb.x-x);})[0];
  if(!hit)return null;hit.scrollIntoView({block:'center'});const r=hit.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
 },{sel,id:tile.assetId,y:tile.gridY,x:tile.gridX});
 if(!point)throw Error('Thumbnail tile could not be brought into view.');
 await wait(350);await page.mouse.move(point.x,point.y);await wait(350);
 const opened=await page.evaluate(({sel,id})=>{
  const tiles=[...document.querySelectorAll(sel)].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;});
  const hit=tiles.find(el=>[...el.querySelectorAll('img,video,source')].some(m=>((m.currentSrc||m.getAttribute('src')||'').match(/\/(?:image|video|asb)\/([^=?/#]+)/)||[])[1]===id));
  const button=hit?.querySelector('button[aria-label="More options"]');if(!button)return false;button.click();return true;
 },{sel,id:tile.assetId});
 if(!opened)throw Error('Thumbnail tile menu did not open.');
 await wait(settleMs);
 const menu=()=>page.evaluate(()=>{const root=document.querySelector('.cdk-overlay-container');if(!root)return[];return[...root.querySelectorAll('[role=menuitem],button,mat-option,li,a')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}).map(el=>{const r=el.getBoundingClientRect();return{text:(el.innerText||el.textContent||'').trim(),aria:el.getAttribute('aria-label'),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};});});
 const before=new Set(fs.readdirSync(dlDir));
 let items=await menu(),download=items.find(x=>/download/i.test(x.text||x.aria||''));
 if(!download)throw Error('Thumbnail tile menu has no Download command.');
 await page.mouse.click(download.x,download.y);await wait(900);
 items=await menu();const original=items.find(x=>/original|full size|\b2k\b|\b4k\b/i.test(x.text||x.aria||''));
 if(original){await page.mouse.click(original.x,original.y);await wait(500);}
 const deadline=Date.now()+90000;let saved=null;
 while(Date.now()<deadline&&!saved){
  await wait(1000);
  for(const name of fs.readdirSync(dlDir)){
   if(before.has(name)||/\.(?:crdownload|part)$/i.test(name))continue;
   const file=path.join(dlDir,name),size=fs.statSync(file).size;await wait(400);
   if(!fs.existsSync(file)||fs.statSync(file).size!==size||size<2048)continue;
   const ext=imageExtension(fs.readFileSync(file));if(!ext)continue;
   for(const other of ['.png','.jpg','.jpeg','.webp'])if(other!==ext)fs.rmSync(path.join(targetDir,'thumbnail_downloaded'+other),{force:true});
   saved=path.join(targetDir,'thumbnail_downloaded'+ext);fs.copyFileSync(file,saved);break;
  }
 }
 await page.keyboard.press('Escape').catch(()=>{});
 if(!saved)throw Error('No completed PNG, JPEG or WebP thumbnail download appeared within 90 seconds.');
 log(`Thumbnail saved: ${saved}`);fs.rmSync(dlDir,{recursive:true,force:true});return saved;
}finally{await cdp.detach().catch(()=>{});}
}
module.exports={imageExtension,downloadThumbnail};
