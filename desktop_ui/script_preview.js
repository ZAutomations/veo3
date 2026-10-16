(function(root){
 function preview(text,seconds=8){
  const chunks=String(text||'').split(/^Story\s+\d+\s*:?\s*$/im).filter(s=>s.trim());
  const stories=chunks.map(s=>{
   const headings=[...s.matchAll(/^Clip\s+(\d+)\s*(?:[-–—]\s*.*?)?\s*:\s*$/gim)].map(m=>Number(m[1]));
   const duration=s.match(/^(?:Estimated duration|Duration):\s*(\d+(?:\.\d+)?)\s*seconds?/im);
   const countAndSeconds=s.match(/^Duration:.*?(\d+)\s+clips?\s+of\s+(\d+)\s+seconds?/im);
   const clipSeconds=Number(s.match(/^Clip seconds:\s*(\d+)/im)?.[1]||countAndSeconds?.[2]||seconds);
   const count=headings.length,total=count*clipSeconds,declared=duration?Number(duration[1]):null;
   const error=headings.some((n,i)=>n!==i+1)?'Clip numbers must start at 1 and be consecutive.':declared!==null&&count>0&&declared!==total?`Declared ${declared}s, but ${count} supplied clips × ${clipSeconds}s = ${total}s.`:'';
   return {count,seconds:clipSeconds,total,error};
  });
  if(!stories.length||stories.every(s=>!s.count))return 'Paste the complete script to detect its clip count and duration. No AI writing.';
  return stories.map((s,i)=>`${stories.length>1?`Story ${i+1}: `:''}${s.count} clips × ${s.seconds} seconds = ${s.total} seconds.${s.error?' Check: '+s.error:''}`).join(' ')+' No AI writing.';
 }
 root.StudioScriptPreview={preview};
 if(typeof module!=='undefined')module.exports={preview};
})(typeof window==='undefined'?globalThis:window);
