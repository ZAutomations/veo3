const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
function runAfterJoin(video,report){
 const file=path.join(__dirname,'video_editing_settings.json');
 let cfg;
 try {cfg=process.env.VEO_EDITING_SETTINGS?JSON.parse(process.env.VEO_EDITING_SETTINGS):fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
 catch(e){throw Error('Cannot read Video Editing settings: '+e.message);}
 if(!cfg||cfg.editing_auto_apply===false||!['silence_removal_enabled','editing_transitions_enabled','clipper_captions_enabled'].some(k=>cfg[k]))return;
 console.log('Applying saved Video Editing settings to the completed combined video...');
 execFileSync(process.env.VEO_PYTHON||'python',[path.join(__dirname,'video_editing.py'),video,'--auto','--order-report',report],
  {cwd:__dirname,env:process.env,stdio:'inherit',windowsHide:true,timeout:7200000});
}
module.exports={runAfterJoin};
