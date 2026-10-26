const fs=require('fs'),path=require('path');
const {spawn}=require('child_process');
function runNode(script,args){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(__dirname,script),...args],{cwd:__dirname,windowsHide:true,stdio:'inherit'});
  child.once('error',reject);child.once('close',code=>resolve(code===null?1:code));
 });
}
async function fixAndJoin(storyArg,{run=runNode,log=console.log,dryRun=false}={}){
 const storyFile=require('./order_clips_by_dialogue').resolveStoryJson(storyArg);
 if(!storyFile)throw Error('Choose a valid story JSON or story folder.');
 const story=JSON.parse(fs.readFileSync(storyFile,'utf8'));
 const expected=story.scenes?.length||0;
 if(!expected)throw Error('The story has no scenes.');
 const clips=path.join(path.dirname(storyFile),'clips');
 if(!fs.existsSync(clips))throw Error('This story has no clips folder. Download the clips first.');
 log('FIX ORDER & JOIN: checking narration against the selected story. Existing videos are preserved; no Flow generation is started.');
 const ordered=await run('order_clips_by_dialogue.js',[storyFile,'--clips',clips,'--write']);
 if(ordered!==0)throw Error('RECOVERY_REVIEW_REQUIRED: Scene-order resolution failed. Existing videos were preserved; joining was not started.');
 const manifest=JSON.parse(fs.readFileSync(path.join(clips,'manifest.json'),'utf8'));
 const mappings=manifest.clips||[];
 const complete=manifest.complete===true&&mappings.length===expected
  &&new Set(mappings.map(c=>c.file)).size===expected
  &&Array.from({length:expected},(_,i)=>i+1).every(n=>mappings.some(c=>c.matched_scene===n&&c.order_verified===true&&c.got!==false))
  &&mappings.every(c=>typeof c.file==='string'&&path.basename(c.file)===c.file&&fs.existsSync(path.join(clips,c.file)));
 if(!complete){
  const missing=manifest.missingScenes||[];
  throw Error(`RECOVERY_REVIEW_REQUIRED: Could not verify all ${expected} story scenes${missing.length?'; unresolved scenes: '+missing.join(', '):''}. See clips/CLIP_ORDER.txt. Joining was not started; no files deleted or substituted.`);
 }
 if(manifest.narrationWarnings?.length)log(`Audio review warning: ${manifest.narrationWarnings.length} clip(s) contain partial or reworded narration. Order is identified; check these before publishing.`);
 log(`FIX ORDER & JOIN: all ${expected} scenes verified. ${dryRun?'Checking join plan':'Joining clips in story order'}...`);
 const joined=await run('join_clips.js',[clips,...(dryRun?['--dry-run']:[])]);
 if(joined!==0)throw Error('Join failed after successful scene-order verification. The verified manifest and original clips were preserved.');
 log(dryRun?'Fix order & Join verification completed; no output encoded.':'Fix order & Join completed.');
 return {expected,clips};
}
if(require.main===module)fixAndJoin(process.argv[2],{dryRun:process.argv.includes('--dry-run')}).catch(e=>{console.error(e.message);process.exitCode=2;});
module.exports={fixAndJoin};
