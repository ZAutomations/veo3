// Download-only grid input. Flow's CDK container supports native DOM scrolling;
// avoid Input.dispatchMouseEvent, which can hang on inactive Chrome windows.
function scrollDownloadContainer(delta){
 const s=document.querySelector('.cdk-virtual-scrollable.page-container')||window.__veoGridScroller?.()||document.scrollingElement;
 if(!s||!s.clientHeight)throw Error('Flow download scroll container is not ready.');
 const before=s.scrollTop,bottom=Math.max(0,s.scrollHeight-s.clientHeight);
 const target=Math.max(0,Math.min(bottom,before+delta));
 s.scrollTop=target;s.dispatchEvent(new Event('scroll',{bubbles:true}));
 const after=s.scrollTop;
 if(Math.abs(target-before)>2&&Math.abs(after-before)<1)throw Error('Flow download grid did not advance. No partial inventory accepted.');
 return {before,after,target,bottom};
}
async function scrollDownloadGrid(page,delta){return page.evaluate(scrollDownloadContainer,delta);}
module.exports={scrollDownloadContainer,scrollDownloadGrid};
