// Restrict reference selection to the Images category in Flow's asset picker.
function categoryState(category){
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
 const labels=[...document.querySelectorAll('.side-nav-list-item-title')].filter(e=>visible(e)&&(e.textContent||'').trim()===category);
 if(labels.length!==1)return {found:false,why:labels.length?'multiple visible category rails':'category not visible'};
 const label=labels[0],item=label.closest('mat-list-item,button,[role="tab"],[role="option"],[role="listitem"],a')||label.parentElement;
 let selected=false,signals=false;
 for(let e=label,n=0;e&&n<4;e=e.parentElement,n++){
  for(const attr of ['aria-selected','aria-current','aria-pressed','aria-checked']){
   if(e.hasAttribute(attr)){signals=true;const v=e.getAttribute(attr);if(v==='true'||v==='page')selected=true;}
  }
  if(/(?:^|[\s_-])(?:active|selected|activated)(?:$|[\s_-])/i.test(String(e.className||'')))selected=true;
 }
 const r=label.getBoundingClientRect();
 return {found:true,selected,x:r.x+r.width/2,y:r.y+r.height/2};
}
async function selectCategory(page,category,{log=()=>{},timeout=12000}={}){
 const before=await page.evaluate(categoryState,category);
 if(!before.found)throw Error(`Reference picker ${category} category was not found. No asset selected.`);
 if(!before.selected)await page.mouse.click(before.x,before.y);
 try{await page.waitForFunction(categoryStateSelected,{timeout},category);}
 catch{throw Error(`Reference picker did not confirm ${category} is selected. No asset selected.`);}
 await new Promise(resolve=>setTimeout(resolve,600));
 log(`Reference picker: ${category} selected; videos excluded.`);
}
async function selectImages(page,opts){return selectCategory(page,'Images',opts);}
function categoryStateSelected(category){
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
 const labels=[...document.querySelectorAll('.side-nav-list-item-title')].filter(e=>visible(e)&&(e.textContent||'').trim()===category);
 if(labels.length!==1)return false;
 let signals=false;
 for(let e=labels[0],n=0;e&&n<4;e=e.parentElement,n++){
  for(const a of ['aria-selected','aria-current','aria-pressed','aria-checked'])if(e.hasAttribute(a)){
   signals=true;const v=e.getAttribute(a);if(v==='true'||v==='page')return true;
  }
  if(/(?:^|[\s_-])(?:active|selected|activated)(?:$|[\s_-])/i.test(String(e.className||'')))return true;
 }
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
  const editor=[...document.querySelectorAll('.ProseMirror[contenteditable="true"]')].find(visible);
  (search||editor)?.focus();
 });
}
module.exports={selectCategory,selectImages,categoryState,categoryStateSelected,focusReferenceSearch};
