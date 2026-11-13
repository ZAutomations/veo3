const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'multilingual-hook-'));try{
 const story=path.join(folder,'english_story.json');fs.writeFileSync(story,JSON.stringify({audio_first:true,multilingual:{enabled:true,languages:[{code:'ru',provider:'heygen',voice:'test'}]}}));
 const calls=[];let failEnglish=false;
 const module={exports:{}};const cfg={editing_auto_apply:true,voiceover_mode:'api',editing_camera_enabled:false};
 vm.runInNewContext(fs.readFileSync('video_editing_hook.js','utf8'),{module,__dirname:process.cwd(),console:{log:()=>{}},process:{platform:'linux',env:{VEO_EDITING_SETTINGS:JSON.stringify(cfg)}},require:name=>name==='child_process'?{execFileSync:(bin,args)=>{if(args[0]?.endsWith('video_editing.py')){calls.push('english');if(failEnglish)throw Error('English failed');}if(args[0]?.endsWith('multilingual.py'))calls.push('localized');return '';}}:require(name)});
 module.exports.runAfterJoin(path.join(folder,'English raw.mp4'),path.join(folder,'JOINED_CLIP_ORDER.txt'));assert.deepEqual(calls,['english','localized']);
 calls.length=0;failEnglish=true;assert.throws(()=>module.exports.runAfterJoin(path.join(folder,'English raw.mp4'),'report'),/English failed/);assert.deepEqual(calls,['english'],'language versions must not start before English succeeds');
 console.log('PASS: finishing hook runs English before language versions and stops localization if English fails; no subprocess launched.');
}finally{fs.rmSync(folder,{recursive:true,force:true});}
