'use strict';
// Translation-process-only transport. Preserve the writer request/schema while
// avoiding Undici connect timeouts observed on this Windows network.
const https=require('https');
function googleFetch(url,options={}){
 const target=new URL(url);if(target.protocol!=='https:'||target.hostname!=='generativelanguage.googleapis.com')throw Error('Unexpected translation API host');
 return new Promise((resolve,reject)=>{
  const body=options.body==null?null:Buffer.from(String(options.body));
  const request=https.request(target,{method:options.method||'GET',family:4,headers:{...(options.headers||{}),...(body?{'Content-Length':body.length}:{})}},response=>{
   const chunks=[];let bytes=0;
   response.on('data',chunk=>{bytes+=chunk.length;if(bytes>16*1024*1024){response.destroy(Error('Translation response too large'));return;}chunks.push(chunk);});
   response.on('error',reject);response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
  });
  const abort=()=>request.destroy(Object.assign(new Error('Translation API request timed out or was aborted'),{name:'AbortError'}));
  request.on('error',reject);request.on('close',()=>options.signal?.removeEventListener('abort',abort));
  if(options.signal?.aborted){abort();return;}
  options.signal?.addEventListener('abort',abort,{once:true});request.setTimeout(45000,abort);
  request.end(body);
 });
}
function install(){
 const original=globalThis.fetch;
 globalThis.fetch=(url,options)=>{const target=new URL(typeof url==='string'?url:url.url||String(url));return target.hostname==='generativelanguage.googleapis.com'?googleFetch(target,options):original(url,options);};
}
module.exports={googleFetch,install};
