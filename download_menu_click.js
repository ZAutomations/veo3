function menuTarget(text){
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const matches=[...document.querySelectorAll('.cdk-overlay-container [role="menuitem"],.cdk-overlay-container mat-option,.cdk-overlay-container button')]
 .filter(e=>visible(e)&&(e.innerText||e.textContent||'').trim()===text&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
 if(matches.length!==1)return null;
 const item=matches[0];item.scrollIntoView({block:'nearest',inline:'nearest'});
 const r=item.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
 return hit&&(hit===item||item.contains(hit))?{x,y}:null;
}
async function clickDownloadOption(page,text,{wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 await page.bringToFront();
 let last;
 for(let i=0;i<20;i++){
  const point=await page.evaluate(menuTarget,text);
  if(point&&last&&Math.abs(point.x-last.x)<1&&Math.abs(point.y-last.y)<1){
   // A trusted click is required here. DOM .click() can close Flow's menu
   // without granting the user activation needed for the download request.
   await page.mouse.click(point.x,point.y);return;
  }
  last=point;await wait(100);
 }
 throw Error('Download option was missing, covered or moving; no transfer requested.');
}
module.exports={menuTarget,clickDownloadOption};
