const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'silent-order-'));
try{
 const storyFile=path.join(temp,'sample_story.json'),clips=path.join(temp,'clips');fs.mkdirSync(clips);
 fs.writeFileSync(storyFile,JSON.stringify({narrated:false,scenes:[{script_line:'',dialogue:[]},{script_line:'',dialogue:[]}]}));
 for(const f of ['first.mp4','second.mp4'])fs.writeFileSync(path.join(clips,f),'fixture');
 const manifest={complete:true,expected:2,clips:[{file:'second.mp4',matched_scene:1,order_verified:true,got:true},{file:'first.mp4',matched_scene:2,order_verified:true,got:true}]};
 fs.writeFileSync(path.join(clips,'manifest.json'),JSON.stringify(manifest));
 const run=()=>spawnSync(process.execPath,[path.join(__dirname,'../order_clips_by_dialogue.js'),storyFile,'--write'],{encoding:'utf8'});
 const verified=run();assert.equal(verified.status,0);assert(verified.stdout.includes('No speech transcription needed'));
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(clips,'manifest.json'),'utf8')),manifest);
 manifest.complete=false;manifest.clips[0].order_verified=false;fs.writeFileSync(path.join(clips,'manifest.json'),JSON.stringify(manifest));
 const pending=run();assert.equal(pending.status,2);assert(pending.stderr.includes('RECOVERY_REVIEW_REQUIRED'));assert(!fs.existsSync(path.join(clips,'.transcripts')));
 console.log('PASS: silent source-verified order preserved; unverified clips require visual review without Whisper or filename guessing.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
