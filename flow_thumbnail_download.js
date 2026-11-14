'use strict';
const fs=require('fs'),path=require('path');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function imageExtension(buf){
 if(buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return '.png';
 if(buf[0]===0xff&&buf[1]===0xd8)return '.jpg';
 if(buf.subarray(0,4).toString()==='RIFF'&&buf.subarray(8,12).toString()==='WEBP')return '.webp';
 return '';
}

// Transfer only the exact completed image represented by the verified Thumbnail tile.
// The authenticated browser handles signed Flow/CDN URLs; no screenshot or new generation.
async function fetchTileImage(page,tile){
 return page.evaluate(async id=>{
  const asset=e=>[e.currentSrc||'',e.getAttribute('src')||''].some(u=>(u.match(/\/(?:image|asb)\/([^=?/#]+)/)||[])[1]===id);
  const tiles=[...document.querySelectorAll('flow-image-tile')].filter(t=>[...t.querySelectorAll('img')].some(asset));
  if(tiles.length!==1)throw Error('Exact Thumbnail asset is not uniquely mounted.');
  const im=[...tiles[0].querySelectorAll('img')].find(asset);
  if(!im.complete||!im.naturalWidth)throw Error('Thumbnail image is not loaded.');
  const src=new URL(im.currentSrc||im.src);
  if(src.origin!==location.origin&&!['flow.google.com','flow-content.google'].includes(src.hostname))throw Error('Unexpected Thumbnail image origin.');
  const response=await fetch(src.href,{credentials:src.origin===location.origin?'include':'omit',signal:AbortSignal.timeout(15000)});
  if(!response.ok||!/^image\//i.test(response.headers.get('content-type')||''))throw Error('Thumbnail response is not a successful image.');
  const blob=await response.blob();if(blob.size<2048||blob.size>50*1024*1024)throw Error('Thumbnail image size failed validation.');
  const decoded=await createImageBitmap(blob);
  const width=decoded.width,height=decoded.height;decoded.close();
  if(width!==im.naturalWidth||height!==im.naturalHeight)throw Error('Thumbnail transfer dimensions differ from the selected image.');
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return {data:btoa(binary),width,height,assetId:id};
 },tile.assetId);
}
function saveTransferredImage(targetDir,result){
 const data=Buffer.from(result.data,'base64'),ext=imageExtension(data);
 if(!ext||data.length<2048)throw Error('Thumbnail transfer is not a valid PNG, JPEG or WebP.');
 fs.mkdirSync(targetDir,{recursive:true});
 const target=require('./story_thumbnail').target(targetDir,ext),temp=target+'.'+process.pid+'.part';
 fs.writeFileSync(temp,data);fs.renameSync(temp,target);
 for(const other of ['.png','.jpg','.jpeg','.webp'])if(other!==ext)fs.rmSync(path.join(targetDir,'thumbnail_downloaded'+other),{force:true});
 return target;
}

async function downloadThumbnail(page,tile,targetDir,log=()=>{},settleMs=2500){
 if(!tile)throw Error('No Flow image tile named Thumbnail was found.');
 try{const result=await fetchTileImage(page,tile),saved=saveTransferredImage(targetDir,result);log(`Thumbnail saved from verified asset (${result.width}x${result.height}): ${saved}`);return saved;}
 catch(error){log('Direct Thumbnail image transfer unavailable; trying the original-size menu: '+error.message);}
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
   saved=require('./story_thumbnail').target(targetDir,ext);fs.copyFileSync(file,saved);break;
  }
 }
 await page.keyboard.press('Escape').catch(()=>{});
 if(!saved)throw Error('No completed PNG, JPEG or WebP thumbnail download appeared within 90 seconds.');
 log(`Thumbnail saved: ${saved}`);fs.rmSync(dlDir,{recursive:true,force:true});return saved;
}finally{await cdp.detach().catch(()=>{});}
}
module.exports={imageExtension,fetchTileImage,saveTransferredImage,downloadThumbnail};
