const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {existingDownloads,nextFilename}=require('../download_resume');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'download-preserve-'));
try{
 const project='https://flow.google.com/project/preserve';
 const a=path.join(folder,'scene-07.mp4'),b=path.join(folder,'scene-02.mp4');
 fs.writeFileSync(a,'asset A bytes');fs.writeFileSync(b,'asset B bytes');
 fs.utimesSync(a,1000,1000);fs.utimesSync(b,1000,1000);
 const manifest={projectUrl:project,complete:true,clips:[{file:'scene-07.mp4',assetId:'A',got:true,matched_scene:1,match_cover:1},{file:'scene-02.mp4',assetId:'B',got:true,matched_scene:2,match_cover:1}]};
 fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest));
 const before=fs.readFileSync(path.join(folder,'manifest.json'),'utf8');
 let result=existingDownloads(folder,project,[{assetId:'B'},{assetId:'A'}],()=>({ok:true}));
 assert.equal(result.get('A').outputFile,'scene-07.mp4');assert.equal(result.get('B').outputFile,'scene-02.mp4');
 assert.equal(fs.statSync(a).mtimeMs,1000000);assert.equal(fs.statSync(b).mtimeMs,1000000);
 assert.equal(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'),before);
 const reserve=new Set();assert.equal(nextFilename(folder,reserve),'scene-01.mp4');assert.equal(nextFilename(folder,reserve),'scene-03.mp4');
 fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({projectUrl:project,clips:[]}));
 result=existingDownloads(folder,project,[{assetId:'A'}],()=>({ok:true}));
 assert.equal(result.get('A').outputFile,'scene-07.mp4');assert.equal(result.get('A').metadata.matched_scene,1);
 console.log('PASS: asset reuse preserves filenames, bytes, timestamps and scene mapping; new names avoid existing files; ledger survives an interrupted manifest.');
}finally{fs.rmSync(folder,{recursive:true,force:true});}
