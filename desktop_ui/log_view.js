(function(root){
 'use strict';
 function create(element,doc){
  doc=doc||document;
  let pending='',paused=false,hasText=false;
  function selecting(){const s=doc.getSelection?.();return !!(s&&!s.isCollapsed&&(element.contains(s.anchorNode)||element.contains(s.focusNode)));}
  function flush(){
   if(paused||!pending)return;
   const follow=element.scrollHeight-element.scrollTop-element.clientHeight<45&&!selecting();
   if(!hasText){element.textContent='';hasText=true;}
   element.appendChild(doc.createTextNode(pending));pending='';
   if(follow)element.scrollTop=element.scrollHeight;
  }
  return {
   append(lines){if(!lines.length)return;pending+=(hasText||pending?'\n':'')+lines.join('\n');flush();},
   pause(value){paused=!!value;if(!paused)flush();return paused;},
   reset(message=''){pending='';hasText=false;element.textContent=message;},
   selecting,
  };
 }
 const api={create};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.StudioLogView=api;
})(typeof window==='undefined'?this:window);
