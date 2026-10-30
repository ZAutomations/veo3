function inspectLayout(close=false){
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
 const candidates=[...document.querySelectorAll('button[aria-label="Close"]')].filter(visible).filter(button=>{
  if(!button.classList.contains('header-action'))return false;
  for(let p=button.parentElement,depth=0;p&&depth<7;p=p.parentElement,depth++){
   const r=p.getBoundingClientRect(),text=p.innerText||p.textContent||'';
   if(r.width>200&&r.width<650&&r.height>300&&/Untitled session|What would you like to create|Brainstorm with me|Build a visual moodboard/i.test(text))return true;
  }
  return false;
 });
 if(candidates.length===1){if(close)candidates[0].click();return 'side-session';}
 return candidates.length?'ambiguous':'normal';
}
async function normalize(page,log=()=>{}){
 const state=await page.evaluate(inspectLayout,true);
 if(state==='ambiguous')throw Error('Multiple session panels found; cannot choose Close safely.');
 if(state==='side-session'){
  log('Closing side session panel to restore the standard project composer.');
  await page.waitForFunction(()=>[...document.querySelectorAll('.ProseMirror,[contenteditable="true"],textarea')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>innerHeight/2;}),{timeout:15000});
 }
 return state;
}
module.exports={normalize,inspectLayout};
