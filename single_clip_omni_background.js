function metrics(){
 const s=document.querySelector('.cdk-virtual-scrollable.page-container')||window.__veoGridScroller?.()||document.scrollingElement;
 const visible=[...document.querySelectorAll('flow-video-tile,flow-image-tile')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.y+r.height>100&&r.y<innerHeight;});
 return {top:s?.scrollTop||0,client:s?.clientHeight||innerHeight,scroll:s?.scrollHeight||document.documentElement.scrollHeight,visible};
}
function scrollToPosition(top){
 const s=document.querySelector('.cdk-virtual-scrollable.page-container')||window.__veoGridScroller?.()||document.scrollingElement;
 if(!s)throw Error('Background Flow scroll container missing.');
 s.scrollTop=Math.max(0,Math.min(top,s.scrollHeight-s.clientHeight));
 s.dispatchEvent(new Event('scroll',{bubbles:true}));
}
function closeMenus(){
 const backdrop=[...document.querySelectorAll('.cdk-overlay-backdrop')].find(e=>e.getBoundingClientRect().width>0);
 if(backdrop)backdrop.click();
}
function openClipMenu({key,assetId}){
 const store=window.__singleOmniTileKeys;
 const tile=[...document.querySelectorAll('flow-video-tile')].find(t=>store?.keys.get(t)===key
  ||assetId&&[...t.querySelectorAll('video,source,img')].some(e=>(e.currentSrc||e.getAttribute('src')||'').includes('/'+assetId)));
 if(!tile)return {ok:false,why:'source tile missing'};
 tile.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
 let owner=tile,menu=null,direct=null;
 for(let depth=0;owner&&depth<8;depth++,owner=owner.parentElement){
  if(owner.querySelectorAll('flow-video-tile').length>1)break;
  menu=owner.querySelector('button[aria-label="More options"]');
  direct=owner.querySelector('button[aria-label="Download batch"]')||direct;
  if(menu)break;
 }
 const button=menu||direct;
 if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return {ok:false,why:'scoped clip menu/download button unavailable'};
 button.click();return {ok:true,direct:!menu};
}
function clickMenuText(text){
 const items=[...document.querySelectorAll('.cdk-overlay-container [role="menuitem"],.cdk-overlay-container mat-option,.cdk-overlay-container button')];
 const matches=items.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(e.innerText||e.textContent||'').trim()===text&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';});
 if(matches.length!==1)return false;
 matches[0].click();return true;
}
module.exports={metrics,scrollToPosition,closeMenus,openClipMenu,clickMenuText};
