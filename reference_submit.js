'use strict';
function blurEditor(){
 const active=document.activeElement;
 if(active?.isContentEditable||active?.closest?.('.ProseMirror'))active.blur();
}
function submitTarget(){
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const buttons=[...document.querySelectorAll('button')].filter(b=>/start generation/i.test(b.getAttribute('aria-label')||'')&&visible(b));
 if(buttons.length!==1)return {ok:false,why:`Expected one visible Start generation button, found ${buttons.length}`};
 const b=buttons[0];
 if(b.disabled||b.getAttribute('aria-disabled')==='true'||/\bdisabled\b/.test(String(b.className)))return {ok:false,why:'Start generation is disabled'};
 b.scrollIntoView({block:'nearest',inline:'nearest'});
 const r=b.getBoundingClientRect(),cx=r.x+r.width/2,cy=r.y+r.height/2,hit=document.elementFromPoint(cx,cy);
 if(!hit||!(hit===b||b.contains(hit)))return {ok:false,why:'Start generation is covered; no click sent'};
 return {ok:true,cx,cy};
}
async function clickSubmit(page,{wait=ms=>new Promise(r=>setTimeout(r,ms)),timeout=5000}={}){
 if(page.bringToFront)await page.bringToFront();
 await page.evaluate(blurEditor);
 const deadline=Date.now()+timeout;let last=null,where;
 do{
  where=await page.evaluate(submitTarget);
  if(where.ok&&last&&Math.abs(where.cx-last.cx)<0.5&&Math.abs(where.cy-last.cy)<0.5){
   await page.mouse.click(where.cx,where.cy);return {ok:true};
  }
  last=where.ok?where:null;await wait(100);
 }while(Date.now()<deadline);
 return {ok:false,why:where?.why||'Start generation did not settle into a clickable position'};
}
module.exports={clickSubmit,submitTarget,blurEditor};
