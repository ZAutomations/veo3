const assert=require('assert'),https=require('https'),{EventEmitter}=require('events'),{googleFetch}=require('../translation_https');
(async()=>{const old=https.request;try{let sent;
 https.request=(url,options,callback)=>{sent={url:String(url),options};const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=e=>req.emit('error',e);req.end=body=>{sent.body=body?.toString();const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'application/json'};callback(res);queueMicrotask(()=>{res.emit('data',Buffer.from('{"lines":["ok"]}'));res.emit('end');req.emit('close');});};return req;};
 const result=await googleFetch('https://generativelanguage.googleapis.com/v1beta/models/test:generateContent',{method:'POST',headers:{'x-goog-api-key':'fixture-secret'},body:'{"contents":[]}'});
 assert(result.ok);assert.deepEqual(await result.json(),{lines:['ok']});assert.equal(sent.options.family,4);assert.equal(sent.options.headers['x-goog-api-key'],'fixture-secret');assert.equal(sent.body,'{"contents":[]}');
 assert.throws(()=>googleFetch('https://other.example'),/Unexpected/);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>googleFetch('https://generativelanguage.googleapis.com',{signal:controller.signal}),/aborted/);
 console.log('PASS: translation HTTPS preserves request payload/auth, reads JSON, enforces host and aborts; no network calls.');
 }finally{https.request=old;}})().catch(e=>{console.error(e);process.exitCode=1;});
