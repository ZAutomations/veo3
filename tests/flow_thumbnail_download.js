const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),puppeteer=require('puppeteer');
const D=require('../flow_thumbnail_download');
(async()=>{
 const bytes=require('child_process').execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x90','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','-']);
 const server=http.createServer((req,res)=>{if(req.url==='/image/fixture'){res.writeHead(200,{'Content-Type':'image/png'});res.end(bytes);}else{res.writeHead(200,{'Content-Type':'text/html'});res.end('<flow-image-tile><img src="/image/fixture"></flow-image-tile>');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'veo-thumbnail-test-'));let browser;
 try{browser=await puppeteer.launch({headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('img').naturalWidth>0);
 const result=await D.fetchTileImage(page,{assetId:'fixture'});assert.equal(result.width,160);assert.equal(result.height,90);
 const saved=await D.downloadThumbnail(page,{assetId:'fixture'},dir);assert(fs.readFileSync(saved).equals(bytes));
 await assert.rejects(D.fetchTileImage(page,{assetId:'wrong'}),/not uniquely mounted/);
 assert.throws(()=>D.saveTransferredImage(dir,{data:Buffer.from('not an image').toString('base64')}),/not a valid/);
 assert(fs.readFileSync(saved).equals(bytes),'invalid response must preserve saved image');
 console.log('PASS: exact thumbnail browser transfer, decoded dimensions, byte preservation, wrong-asset rejection and invalid-response preservation.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
