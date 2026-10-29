const fs=require('fs'),path=require('path');
const {words}=require('./ready_script_parser');

function exportScript(source,index=1){
 const out=[`Story ${source.storyNumber||index}`,`Title: ${source.title}`,`Preset: ${source.preset}`];
 if(source.production_profile)out.push(`Production profile: ${source.production_profile}`);
 out.push(`Clip seconds: ${source.seconds}`);
 if(source.declaredCount){
  out.push(`Duration: ${source.declaredDuration!==null&&source.declaredDuration!==undefined?source.declaredDuration+' seconds. Exactly ':''}${source.declaredCount} clips of ${source.seconds} seconds.`);
 }else if(source.declaredDuration!==undefined&&source.declaredDuration!==null)out.push(`Estimated duration: ${source.declaredDuration} seconds`);
 if(source.setting)out.push(`Setting: ${source.setting}`);
 if(source.details)out.push(`Details: ${source.details}`);
 if(source.story_brief)out.push(`Story brief: ${source.story_brief}`);
 if(source.sources)out.push(`Sources: ${source.sources}`);
 if(source.location_name)out.push(`Location name: ${source.location_name}`);
 for(const [key,label] of [['left_label','Left label'],['right_label','Right label'],['footer_start','Footer start'],['footer_end','Footer end']])if(source[key])out.push(`${label}: ${source[key]}`);
 for(const [key,label] of [['characters','Characters'],['locations','Locations']]){
  out.push(label+':',...(source[key]?.length?source[key].map(item=>`${item.name}: ${item.description}`):['None']));
 }
 if(source.continuity)out.push(`Continuity: ${source.continuity}`);
 for(const clip of source.clips){
  out.push('',`Clip ${clip.number}${clip.title?' — '+clip.title:''}:`);
  if(clip.narration!==undefined)out.push(`Narration: "${clip.narration}"`);
  if(clip.start_state)out.push(`Start state: ${clip.start_state}`);
  if(clip.action)out.push(`Action: ${clip.action}`);
  for(const turn of clip.dialogue||[])out.push(`${turn.speaker}: "${turn.line}"`);
  for(const [i,shot] of (clip.shots||[]).entries())out.push(`Shot ${i+1}: ${shot.start_seconds}–${shot.end_seconds} seconds — ${shot.visual}`);
  if(clip.end_state)out.push(`End state: ${clip.end_state}`);
  if(clip.effect!==undefined)out.push(`Effect: ${clip.effect}`);
  if(clip.sound!==undefined)out.push(`Sound: ${clip.sound}`);
 }
 return out.join('\n')+'\n';
}

function sourceDocument(source){return {...source,storyNumber:source.storyNumber||null,
 production_profile:source.production_profile||'legacy-compatible',warnings:source.warnings||[],
 source_lines:{story:source._source?.line,fields:source._source?.fields,
  clips:source.clips.map(c=>({clip:c.number,line:c._source?.line,fields:c._source?.fields,shots:c._source?.shots}))}};}

function preflight(source,prepared,folder){
 const story=folder&&fs.existsSync(path.join(folder,path.basename(folder)+'_story.json'))
  ?JSON.parse(fs.readFileSync(path.join(folder,path.basename(folder)+'_story.json'),'utf8')):prepared.story;
 const prompts=require('./single_scene_prompts');
 const clips=story.scenes.map((scene,i)=>{
  const saved=folder&&path.join(folder,'clip_prompts',`clip_${String(i+1).padStart(3,'0')}.txt`);
  const prompt=saved&&fs.existsSync(saved)?fs.readFileSync(saved,'utf8'):prompts.promptForScene(story,i);
  const original=source.clips[i];
  return {number:i+1,narration:scene.script_line||'',word_count:words(scene.script_line||''),
   estimated_speech_seconds:Math.round(words(scene.script_line||'')/2.5*10)/10,
   shots:scene.shots||original?.shots||[],effect:scene.effect??original?.effect??'',sound:scene.sound??original?.sound??'',
   source_line:original?._source?.line,prompt};
 });
 return {schema_version:1,storyNumber:source.storyNumber||null,title:story.title,preset:source.preset,
  production_profile:source.production_profile||'legacy-compatible',clips:clips.length,clip_seconds:source.seconds,
  total_seconds:clips.length*source.seconds,locations:source.locations,continuity:source.continuity||'',
  warnings:[...new Set([...(source.warnings||[]),...(prepared.warnings||[])])],scenes:clips,
  note:'Exported scene prompts are shown verbatim. The generation driver adds selected model, resolution and attached asset instructions at run time. No generation credits were used.'};
}

function reportText(report){
 const out=['READY SCRIPT PREFLIGHT',`Story: ${report.storyNumber||'(unnumbered)'} — ${report.title}`,`Preset: ${report.preset}`,
  `Profile: ${report.production_profile}`,`${report.clips} clips × ${report.clip_seconds}s = ${report.total_seconds}s`,
  '',`Locations: ${JSON.stringify(report.locations,null,2)}`,`Continuity: ${report.continuity||'(not supplied)'}`,
  '',...report.warnings.map(w=>'WARNING: '+w),'',report.note];
 for(const scene of report.scenes){
  out.push('',`=== CLIP ${scene.number} · line ${scene.source_line||'?'} · ${scene.word_count} words ===`,
   `Narration: ${scene.narration}`,...scene.shots.map((shot,i)=>`Shot ${i+1}: ${shot.start_seconds}–${shot.end_seconds}s — ${shot.visual}`),
   `Effect: ${scene.effect}`,`Sound: ${scene.sound}`,'','EXPORTED VIDEO PROMPT:',scene.prompt);
 }
 return out.join('\n')+'\n';
}

function write(folder,source,prepared,originalText){
 const report=preflight(source,prepared,folder);
 const files={
  'IMPORT_PREFLIGHT.json':JSON.stringify(report,null,2)+'\n',
  'IMPORT_PREFLIGHT.txt':reportText(report),
  'READY_SCRIPT_EXPORT.txt':exportScript(source),
  'READY_SCRIPT_SOURCE.json':JSON.stringify(sourceDocument(source),null,2)+'\n',
 };
 // Preserve the actual supplied batch independently from canonical export.
 if(originalText!==undefined)files['READY_SCRIPT_ORIGINAL.txt']=originalText;
 for(const [name,text] of Object.entries(files)){
  const file=path.join(folder,name),temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,text);fs.renameSync(temp,file);
 }
 return report;
}
module.exports={exportScript,sourceDocument,preflight,reportText,write};
