const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {execFileSync}=require('child_process'),R=require('../manual_download_receipt'),{UpscaledDownloader}=require('../single_clip_omni_upscaled');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manual-download-'));try{
 const out=path.join(dir,'clips');fs.mkdirSync(out);const file=path.join(out,'manual.mp4');
 execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=size=720x1280:rate=10:duration=0.2','-c:v','libx264','-preset','ultrafast',file],{windowsHide:true});
 const sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const data={project:'project',storyHash:'hash',clips:[{file:'manual.mp4',assetId:'source',sha256,acceptedFor:'upscaled',userConfirmedSource:true}]};
 const receipt=path.join(dir,'MANUAL_DOWNLOAD_RECEIPTS.json');fs.writeFileSync(receipt,JSON.stringify(data));
 assert(R.find(dir,out,'project','hash','source','upscaled'));
 for(const args of [['other','hash','source','upscaled'],['project','changed','source','upscaled'],['project','hash','wrong','upscaled'],['project','hash','source','original']])assert.equal(R.find(dir,out,...args),null);
 const d=new UpscaledDownloader({projectUrl:'project'},{folder:dir,total:1,storyHash:'hash',downloadVersion:'upscaled',orderMode:'unresolved-assets'});
 d.open=()=>{throw Error('Browser must not be opened for verified manual file');};
 const entry=await d.download({number:1,prompt:'AGENT ASSET ID: source'},{assetId:'source'});
 assert.equal(entry.route,'manual-original-720p');assert.equal(entry.sha256,sha256);assert(entry.manualReceipt);
 fs.appendFileSync(file,'modified');assert.equal(R.find(dir,out,'project','hash','source','upscaled'),null);
 console.log('PASS: explicit source/story/project-bound manual receipt skips browser; media decoded; actual route retained; wrong version/source/story or modified files rejected.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
