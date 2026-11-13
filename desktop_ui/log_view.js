(function(root){
 'use strict';
 function isError(line){
  const text=String(line).replace(/\b(?:no|zero|0)\s+(?:errors?|exceptions?|failures?|failed)\b/gi,'')
   .replace(/\bfailed\s*[:=]\s*0\b/gi,'');
  return /\b(?:errors?|exceptions?|traceback|fatal|refusing to join|unable to|timed out|timeout|unusual activity)\b/i.test(text)
   ||/\b[A-Za-z]*(?:Error|Exception)\b/.test(text)
   ||/(?:RECOVERY_REVIEW_REQUIRED|FLOW_REVIEW_REQUIRED|THUMBNAIL_REQUIRED|CLIP_DURATION_(?:MISMATCH|UNVERIFIED)|SCENE_NAMING_FAILED|IMPORT_VALIDATION_FAILED)\b/.test(text)
   ||/\bfailed\s*(?:at\b|:|!|\.)|\b(?:download|generation|run|validation|workflow|submission|driver)\s+failed\b|\bwaiting\b.*\bfailed\b/i.test(text)
   ||/\b[1-9]\d*\s+(?:failed|failures?)\b|\bfailed\s*[:=]\s*[1-9]\d*\b/i.test(text)
   ||/\b(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|code)\s*[:=]?\s*-?[1-9]\d*\b/i.test(text)
   ||/\bthis prompt\b.*\b(?:violate|polic)|\breputational risk\b/i.test(text)
   ||/^\s*(?:\[[^\]]+\]\s*)*FAILED\s*[:.!]?\s*$/i.test(text)
   ||/^\s*(?:\[[^\]]+\]\s*)*(?:at\s+\S+.*:\d+|File\s+"[^"]+",\s+line\s+\d+)/.test(text);
 }
 function create(element,doc){
  doc=doc||document;
  let pending='',paused=false,hasText=false;
  function selecting(){const s=doc.getSelection?.();return !!(s&&!s.isCollapsed&&(element.contains(s.anchorNode)||element.contains(s.focusNode)));}
  function flush(){
   if(paused||!pending)return;
   const follow=element.scrollHeight-element.scrollTop-element.clientHeight<45&&!selecting();
   if(!hasText){element.textContent='';hasText=true;}
   // Append only new nodes: rebuilding innerHTML breaks selection and scroll.
   // Text content also keeps paths/prompts containing HTML safely inert.
   let normal='';
   for(const part of pending.match(/[^\n]*\n|[^\n]+$/g)||[]){
    if(isError(part)){
     if(normal){element.appendChild(doc.createTextNode(normal));normal='';}
     const span=doc.createElement('span');span.className='log-error';span.textContent=part;
     element.appendChild(span);
    }else normal+=part;
   }
   if(normal)element.appendChild(doc.createTextNode(normal));pending='';
   if(follow)element.scrollTop=element.scrollHeight;
  }
  return {
   append(lines){if(!lines.length)return;pending+=(hasText||pending?'\n':'')+lines.join('\n');flush();},
   pause(value){paused=!!value;if(!paused)flush();return paused;},
   reset(message=''){pending='';hasText=false;element.textContent=message;},
   selecting,
  };
 }
 const api={create,isError};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.StudioLogView=api;
})(typeof window==='undefined'?this:window);
