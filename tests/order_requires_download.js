const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'order-needs-download-'));
try{
 const file=path.join(temp,'sample_story.json'),clips=path.join(temp,'clips');
 fs.writeFileSync(file,JSON.stringify({narrated:false,scenes:[{script_line:'',dialogue:[]}]}));
 const run=()=>spawnSync(process.execPath,[path.join(__dirname,'../order_clips_by_dialogue.js'),file,'--write'],{encoding:'utf8'});
 for(const empty of [false,true]){
  if(empty)fs.mkdirSync(clips);
  const result=run();assert.equal(result.status,2);assert(result.stderr.includes('RECOVERY_REVIEW_REQUIRED:'));assert(result.stderr.includes('Download clips first'));assert(result.stderr.includes('Retry / Continue'));assert(!fs.existsSync(path.join(clips,'manifest.json')));assert(!fs.existsSync(path.join(clips,'.transcripts')));
 }
 console.log('PASS: missing and empty clips folders stop futile retries and direct the user to download; no manifest or transcription created.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
