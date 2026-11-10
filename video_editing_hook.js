const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
function editingPython(){
 const candidates=[];
 if(process.env.VEO_PYTHON)candidates.push(process.env.VEO_PYTHON);
 if(process.platform==='win32'){
  try{
   const output=execFileSync('py',['-0p'],{encoding:'utf8',timeout:10000,windowsHide:true});
   for(const line of output.split(/\r?\n/)){
    const match=line.match(/([A-Za-z]:\\.*?pythonw?\.exe)\s*$/i);
    if(match&&!candidates.includes(match[1]))candidates.push(match[1]);
   }
  }catch{}
  const roots=[process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Programs','Python'),
   process.env.USERPROFILE&&path.join(process.env.USERPROFILE,'AppData','Local','Programs','Python')].filter(Boolean);
  for(const root of roots){
   try{for(const name of fs.readdirSync(root)){
    const candidate=path.join(root,name,'python.exe');
    if(/^Python\d+$/i.test(name)&&fs.existsSync(candidate)&&!candidates.includes(candidate))candidates.push(candidate);
   }}catch{}
  }
 }
 if(!candidates.includes('python'))candidates.push('python');
 const probe='import numpy, PIL, moviepy, scipy, whisper';
 for(const candidate of candidates){
  try{execFileSync(candidate,['-c',probe],{stdio:'ignore',timeout:20000,windowsHide:true});return candidate;}catch{}
 }
 throw Error('Video Editing needs Python with NumPy, Pillow, MoviePy, SciPy and Whisper installed.');
}
function hasPresetCTA(video,cfg){
 if(cfg.preset_cta_enabled===false)return false;
 const folder=path.dirname(path.resolve(video));
 const stories=fs.readdirSync(folder).filter(f=>/_story\.json$/i.test(f));
 if(stories.length!==1)return false;
 const preset=JSON.parse(fs.readFileSync(path.join(folder,stories[0]),'utf8').replace(/^\uFEFF/,'')).preset_id;
 if(!/^[a-z0-9][a-z0-9-]*$/.test(preset||''))return false;
 return ['.mp4','.mov','.mkv','.webm'].some(ext=>fs.existsSync(path.join(__dirname,'Preset References',preset,preset+'CTA'+ext)));
}
function runAfterJoin(video,report){
 const file=path.join(__dirname,'video_editing_settings.json');
 let cfg;
 try {cfg=process.env.VEO_EDITING_SETTINGS?JSON.parse(process.env.VEO_EDITING_SETTINGS):fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{editing_auto_apply:true,editing_camera_enabled:true};}
 catch(e){throw Error('Cannot read Video Editing settings: '+e.message);}
 if(cfg) console.log(`Post-join camera transition request: ${cfg.editing_camera_enabled?'ON':'OFF'}; auto-apply: ${cfg.editing_auto_apply===false?'OFF':'ON'}.`);
 if(!cfg||cfg.editing_auto_apply===false)return;
 const effects=['silence_removal_enabled','editing_transitions_enabled','clipper_captions_enabled','editing_camera_enabled'].some(k=>cfg[k])||Object.keys(cfg).some(k=>k.startsWith('camera_effect_')&&k!=='camera_effect_duration'&&cfg[k]===true)||Math.abs(Number(cfg.editing_speed??1)-1)>1e-8||cfg.voiceover_mode&&cfg.voiceover_mode!=='native';
 if(!effects&&!hasPresetCTA(video,cfg))return;
 console.log('Applying saved Video Editing settings to the completed combined video...');
 const python=editingPython();
 console.log('Video Editing Python: '+python);
 execFileSync(python,[path.join(__dirname,'video_editing.py'),video,'--auto','--order-report',report],
  {cwd:__dirname,env:process.env,stdio:'inherit',windowsHide:true,timeout:7200000});
}
module.exports={runAfterJoin,editingPython,hasPresetCTA};
