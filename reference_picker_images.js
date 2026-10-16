// Restrict reference selection to the Images category in Flow's asset picker.
function categoryState(category){
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
 const labels=[...document.querySelectorAll('.side-nav-list-item-title')].filter(e=>visible(e)&&(e.textContent||'').trim()===category);
 if(labels.length!==1)return {found:false,why:labels.length?'multiple visible category rails':'category not visible'};
 const label=labels[0],item=label.closest('mat-list-item,button,[role="tab"],[role="option"],[role="listitem"],a')||label.parentElement;
 let selected=false,signals=false;
 for(let e=label,n=0;e&&n<10;e=e.parentElement,n++){
  for(const attr of ['aria-selected','aria-current','aria-pressed','aria-checked']){
   if(e.hasAttribute(attr)){signals=true;const v=e.getAttribute(attr);if(v==='true'||v==='page')selected=true;}
  }
  if(/(?:^|[\s_-])(?:active|selected|activated)(?:$|[\s_-])/i.test(String(e.className||'')))selected=true;
 }
 const r=label.getBoundingClientRect();
 return {found:true,selected,x:r.x+r.width/2,y:r.y+r.height/2};
}
async function selectCategory(page,category,{log=()=>{},timeout=12000}={}){
 // Images and Voices use the same picker and category-selection handshake.
 // RAF polling may stop in a hidden Chrome tab even though the DOM has updated.
 if(page.bringToFront)await page.bringToFront();
 for(let attempt=1;attempt<=3;attempt++){
  const before=await page.evaluate(categoryState,category);
  if(before.found){
   if(!before.selected)await page.mouse.click(before.x,before.y);
   try{
    await page.waitForFunction(categoryStateSelected,{timeout:Math.max(1000,Math.ceil(timeout/3)),polling:100},category);
    await new Promise(resolve=>setTimeout(resolve,600));
    log(`Reference picker: ${category} selected; videos excluded.`);
    return;
   }catch(error){
    // The last DOM check also covers a state change just at the timeout boundary.
    if(await page.evaluate(categoryStateSelected,category)){
     log(`Reference picker: ${category} selected; videos excluded.`);return;
    }
   }
  }
  if(attempt<3)log(`Reference picker: ${category} not confirmed; retrying category selection (${attempt+1}/3).`);
 }
 throw Error(`Reference picker did not confirm ${category} is selected after 3 checks. No asset selected.`);
}
async function selectImages(page,opts){return selectCategory(page,'Images',opts);}
function categoryStateSelected(category){
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
 const labels=[...document.querySelectorAll('.side-nav-list-item-title')].filter(e=>visible(e)&&(e.textContent||'').trim()===category);
 if(labels.length!==1)return false;
 let signals=false;
 for(let e=labels[0],n=0;e&&n<10;e=e.parentElement,n++){
  for(const a of ['aria-selected','aria-current','aria-pressed','aria-checked'])if(e.hasAttribute(a)){
   signals=true;const v=e.getAttribute(a);if(v==='true'||v==='page')return true;
  }
  if(/(?:^|[\s_-])(?:active|selected|activated)(?:$|[\s_-])/i.test(String(e.className||'')))return true;
 }
 // The category rail can carry aria-selected=false on wrapper elements even
 // after filtering succeeds. Verify the actual asset list inside this picker.
 const picker=labels[0].closest('.cdk-overlay-pane');
 const assets=picker?.querySelectorAll?[...picker.querySelectorAll('button.asset-item,[class*="asset-card"]')].filter(visible):[];
 if(category==='Voices'&&assets.length&&assets.every(e=>!!e.querySelector?.('.asset-thumbnail-voice, .voice-icon')))return true;
 if(category==='Images'&&assets.length&&assets.every(e=>/\bImage\s*$/i.test(String(e.innerText||e.textContent||'').trim())))return true;
 let scope=labels[0].closest('mat-list-item,button,[role="tab"],[role="option"],[role="listitem"],a')||labels[0].parentElement;
 while(scope&&!scope.querySelector('button.asset-item,[role="option"],[class*="asset-card"]'))scope=scope.parentElement;
 const rows=scope?[...scope.querySelectorAll('button.asset-item,[role="option"],[class*="asset-card"]')].filter(visible):[];
 return !signals&&category==='Images'&&rows.length>0&&rows.every(e=>/\bImage\s*$/i.test(String(e.innerText||e.textContent||'').trim()));
}
async function focusReferenceSearch(page){
 await page.evaluate(()=>{
  const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  const overlay=[...document.querySelectorAll('.cdk-overlay-pane')].find(e=>visible(e)&&e.querySelector('.side-nav-list-item-title'));
  const search=overlay&&[...overlay.querySelectorAll('input')].find(e=>visible(e)&&/search/i.test(`${e.placeholder||''} ${e.getAttribute('aria-label')||''}`));
  const editor=window.__veoAgentEditor?.()||[...document.querySelectorAll('.ProseMirror[contenteditable="true"]')].find(visible);
  (search||editor)?.focus();
 });
}
function clickNamedAsset(name){
 const norm=s=>String(s||'').trim().replace(/\.(?:jpg|jpeg|png|webp)$/i,'').toLowerCase();
 const buttons=[...document.querySelectorAll('.cdk-overlay-pane button.asset-item')].filter(b=>b.getBoundingClientRect().width>0&&!b.disabled&&norm(b.querySelector('.asset-title')?.textContent||b.textContent)===norm(name));
 if(buttons.length!==1)return false;
 const b=buttons[0];
 if(b.getAttribute('aria-selected')!=='true'&&b.getAttribute('aria-pressed')!=='true'&&!/(?:^|\s)selected(?:\s|$)/.test(b.className))b.click();
 return true;
}
function selectionState(){
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
 const editor=window.__veoAgentEditor?.()||[...document.querySelectorAll('.ProseMirror')].find(visible);
 const chips=editor?.querySelectorAll('.mention-chip').length||0;
 const add=[...document.querySelectorAll('.cdk-overlay-pane button')].filter(b=>visible(b)&&/^add to prompt$/i.test((b.innerText||b.textContent||'').trim())&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');
 return {chips,canConfirm:add.length===1};
}
function clickAddToPrompt(){
 const buttons=[...document.querySelectorAll('.cdk-overlay-pane button')].filter(b=>b.getBoundingClientRect().width>0&&/^add to prompt$/i.test((b.innerText||b.textContent||'').trim())&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');
 if(buttons.length!==1)return false;buttons[0].click();return true;
}
async function confirmSelection(page,{expected,log=()=>{}}){
 const deadline=Date.now()+10000;let confirmed=false;
 while(Date.now()<deadline){
  const state=await page.evaluate(selectionState);
  if(state.chips>=expected)return;
  if(state.canConfirm&&!confirmed){
   if(!await page.evaluate(clickAddToPrompt))throw Error('Reference Add to prompt button was not confirmed.');
   confirmed=true;log('Reference selection: Add to prompt confirmed.');
  }
  await new Promise(r=>setTimeout(r,100));
 }
 throw Error(`Reference attachment did not confirm ${expected} chip(s). No generation submitted.`);
}
module.exports={selectCategory,selectImages,categoryState,categoryStateSelected,focusReferenceSearch,clickNamedAsset,selectionState,confirmSelection};
