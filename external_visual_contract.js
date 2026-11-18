'use strict';
const fs=require('fs'),path=require('path');
function catalog(){return ['styles.json','genai_styles.json'].flatMap(file=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,file),'utf8')).styles||[];}catch{return [];}});}
function preset(story){return story.reference_preset||story.imported_preset||catalog().find(p=>p.id===story.preset_id)||{id:story.preset_id,style:story.style,palette:story.palette,camera:story.camera,avoid:story.avoid};}
function visualNotes(text){
 // Do not copy native voice/BGM/quoted speech instructions into a silent tool prompt.
 return String(text||'').split(/\n|(?<=[.!?])\s+(?=[A-Z])/).filter(part=>!/(?:read exactly|read the|narrat|voice.?over|dialogue|spoken|speaker|singing|soundtrack|\bbgm\b|\bmusic\b|eight.second|eight seconds|0-3s|e\.g\.|After Join|CLIP-TO-CLIP|_edited\.mp4|post.join|application, not Veo)/i.test(part)).join(' ');
}
function sfxOnly(text){
 const raw=String(text||'').replace(/\b(?:under|beneath|during) narration\b/gi,'under the external track');
 const labeled=raw.match(/\b(?:SFX|SOUND EFFECTS)\s*:\s*([\s\S]*?)(?=\b(?:BGM|MUSIC|MIX|NARRATION|DIALOGUE)\s*:|$)/i);
 return (labeled?labeled[1]:raw).split(/[;\n]/).filter(s=>!/(?:\bbgm\b|\bmusic\b|soundtrack|lyrics|narrat|dialogue|read exactly|voice.?over|\bsays?\b|whisper|singing|spoken words|chanting)/i.test(s)).join('; ').trim();
}
function visualDNA(value){
 if(typeof value==='string')return visualNotes(value);
 if(Array.isArray(value))return value.map(visualDNA);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/audio|music|voice|speech|narrat|dialogue|sound/i.test(k)).map(([k,v])=>[k,visualDNA(v)]));
 return value;
}
function sourceEvents(story,scene){
 if(Array.isArray(scene.external_visual_events))return scene.external_visual_events;
 if(!story.full_voiceover_first||!story.original_story)return [];
 try{
  const original=JSON.parse(fs.readFileSync(story.original_story,'utf8'));
  const sections=story.full_voiceover_visual_sections||story.full_voiceover_sections;
  const start=scene.full_voiceover_start,stop=scene.full_voiceover_end;
  if(!Array.isArray(sections)||!Number.isFinite(start)||!Number.isFinite(stop))return [];
  const events=[];
  for(let i=0;i<sections.length;i++){
   const [a,b]=sections[i],left=Math.max(start,a),right=Math.min(stop,b),source=original.scenes?.[i];
   if(!source||right<=left||b<=a)continue;
   const effect=source.effect||'',sound=source.sound||source.sound_context||'';
   if(!effect&&!sound)continue;
   const duration=Number(original.scene_seconds||story.scene_seconds||10);
   events.push({start_seconds:+(left-start).toFixed(3),end_seconds:+(right-start).toFixed(3),source_beat:i+1,source_start_seconds:+((left-a)/(b-a)*duration).toFixed(3),source_end_seconds:+((right-a)/(b-a)*duration).toFixed(3),effect,sound});
  }
  return events;
 }catch{return [];}
}
function forScene(story,scene,seconds){
 const p=preset(story),id=story.preset_id||p.id,events=sourceEvents(story,scene);
 const locations=story.imported_locations?.length?story.imported_locations:story.reference_locations?.length?story.reference_locations:story.place?[{name:story.place.name,description:story.place.description||''}]:[];
 const family=['geography-map','3d-zack-style','intimacy-health-3d','cats-behavior-3d','fern-documentary','world-politics-map-explain'].includes(id);
 const camera=family?'Follow the supplied targets and timing; preserve explicit locked/static framing, otherwise use the family camera contract below.':visualNotes(p.camera||story.camera||'Follow the supplied framing and motivated movement.');
 const lines=['PRESET VISUAL DELIVERY — EXTERNAL VOICEOVER: Preserve this preset visual identity and every supplied action. The selected runtime and timed visual plan override fixed-duration authoring examples. All speech is supplied externally; never voice instructions or lettering.',
  'PRESET RENDERING: '+visualNotes(story.style||p.style)+' PALETTE: '+visualNotes(story.palette||p.palette),
  'PRESET CAMERA: '+camera,
  'PRESET VISUAL RULES: '+(family?'Use the family rules below.':visualNotes(p.direction))+' AVOID: '+visualNotes(p.avoid||story.avoid),
  'LOCATION DESIGN: '+JSON.stringify(locations)+' Use the actual setting in each supplied shot; a reference is not a universal background.',
  story.visual_continuity?'WORLD/PROP CONTINUITY: '+visualNotes(story.visual_continuity):'',
  p.setting?'PRESET SETTING LOCK: '+visualNotes(p.setting):'',story.blocking?'SPATIAL BLOCKING: '+visualNotes(story.blocking):'',
  scene.imported_action?'SUPPLIED ACTION: '+visualNotes(scene.imported_action):'',
  scene.start_state?'START STATE: '+visualNotes(scene.start_state):'',scene.end_state?'END STATE: '+visualNotes(scene.end_state):'',
  'SOURCE-ALIGNED CALLOUTS: Show only the supplied important names, places, objects and numeric facts as exact short readable labels or recognizable icons beside their actual visible targets. Sequence at most two overlays in source order. Popup/click on label/icon entry, typewriter ticks during exact numeric/date type-on, then readable hold and clear exit. No whole-speech subtitles, invented values, thoughts, evidence or real-person likenesses. For silent visuals use the explicit shot facts only.',
  require('./current_events_policy').split('\n').slice(0,2).join(' '),require('./prominent_people_policy').split('\n').slice(0,2).join(' ')];
 if(['3d-zack-style','intimacy-health-3d','cats-behavior-3d'].includes(id))lines.push(require('./zack_topic_visuals').CONTRACT,require('./zack_camera_transitions').DIRECTION,
  'ZACK FAMILY RENDERING: Preserve the selected preset/reference multicolour materials, dimensional lighting and topic-accurate physical/anatomical rendering. Use cutaways only for the supplied mechanism; no generic laboratory or cyan-only substitution. Characters retain their approved anatomy and proportions.');
 if(id==='fern-documentary')lines.push(require('./fern_topic_visuals').CONTRACT,require('./fern_topic_visuals').GRAPHICS);
 if(id==='world-politics-map-explain'){
  lines.push('WORLD POLITICS HYBRID: Honor the existing [MAP], [RECONSTRUCTION] and [EXPLAINER] markers independently. MAP uses accurate relief and visible physical assets; RECONSTRUCTION uses faceless matte 3D people in the actual setting; EXPLAINER uses editorial ink/vector diagrams on off-white. Preserve the supplied whole-story medium allocation; never turn every shot into a generic map or office. Use the source-supported facts, dates and uncertainty only.');
  const cues=require('./politics_visual_alignment').cues({script_line:scene.external_narration||scene.script_line||''},seconds);
  if(cues.length)lines.push('POLITICS SUBJECT GRAPHICS: '+cues.map(c=>`${c.label}: ${c.visual}; anchor to the corresponding visible target, popup on entry, clear afterward`).join('; '));
 }
 if(story.reference_preset){
  const dna=p.analysis_dna||{};
  lines.push('REFERENCE-DERIVED VISUAL DNA: '+JSON.stringify(visualDNA(Object.fromEntries(Object.entries(dna).filter(([k])=>/visual|camera|lighting|palette|composition|motion|material|render|graphic|typograph|environment/i.test(k)&&!/audio|music|voice|speech/i.test(k))))));
 }
 if(!['3d-zack-style','intimacy-health-3d','cats-behavior-3d'].includes(id)&&!/locked|static camera|fixed camera|peaceful framing|relaxed framing|no (?:further )?(?:zoom|pan)/i.test(p.camera||'')&&!/lofi|fall-asleep/.test(id||''))lines.push(require('./within_clip_camera_contract').DIRECTION);
 if(!events.length&&scene.effect&&scene.effect!=='None')lines.push('SUPPLIED VISUAL EFFECT: '+visualNotes(scene.effect));
 const sfx=sfxOnly(scene.sound||scene.sound_context);
 if(sfx)lines.push('SUPPLIED NON-VOCAL SFX: '+sfx);
 for(const event of events){
  const effect=visualNotes(event.effect),sound=sfxOnly(event.sound);
  if(effect||sound)lines.push(`MAPPED SOURCE EFFECT/SFX: current clip ${event.start_seconds}-${event.end_seconds}s corresponds to original beat ${event.source_beat} at ${event.source_start_seconds}-${event.source_end_seconds}s. Apply ONLY relevant supplied events in this overlap; convert source timings into this clip interval. Visual effect: ${effect||'none'}. Non-vocal SFX: ${sound||'none'}. Do not apply events outside this interval.`);
 }
 lines.push('PRIORITY: no native narrator, human dialogue, singing or lip-sync. Retain permitted non-vocal action sounds and explicitly supplied animal sounds. Do not invent actions, change a locked/static camera, extend runtime or add music. Supplied visual targets and source-supported facts take priority over generic preset examples.');
 return lines.filter(Boolean).join('\n\n');
}
module.exports={catalog,preset,visualNotes,sfxOnly,visualDNA,sourceEvents,forScene};
