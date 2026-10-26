'use strict';
const applies=p=>p?.derived_video_preset===true;
function validate(source,p){
 if(source.seconds!==8)throw Error('Reference-derived presets use eight-second clips.');
 const names=new Set(p.reference_cast.map(c=>c.name));
 for(const c of source.clips){
  if(p.ready_script_mode==='dialogue'){if(!c.dialogue.length||c.narration)throw Error(`Clip ${c.number}: use labelled character dialogue only.`);for(const t of c.dialogue)if(!names.has(t.speaker))throw Error(`Unknown speaker ${t.speaker}.`);}
  else if(c.dialogue.length||p.ready_script_mode==='narrated_visual'&&!c.narration||p.ready_script_mode==='silent_visual'&&c.narration)throw Error(`Clip ${c.number}: speech fields do not match this preset.`);
  if(!c.sound||!c.start_state||!c.end_state)throw Error(`Clip ${c.number}: supply Audio:, Start state: and End state:.`);
  if(!c.shots.length||c.shots.length>4)throw Error(`Clip ${c.number}: supply one to four timed shots.`);
  let end=0;for(const s of c.shots){if(s.start_seconds!==end||s.end_seconds<=end||s.end_seconds>8)throw Error(`Clip ${c.number}: shot timings must cover 0–8 without gaps or overlaps.`);end=s.end_seconds;}if(end!==8)throw Error(`Clip ${c.number}: shots must end at 8 seconds.`);
 }
}
function scene(story,index,options={}){
 const s=story.scenes[index],p=story.reference_preset;
 const speech=p.ready_script_mode==='dialogue'?'Only the named speaker delivers each complete turn. Other mouths remain closed. Leave a brief natural gap between speakers.\n'+s.dialogue.map(t=>t.speaker+': "'+t.line+'"').join('\n'):p.ready_script_mode==='narrated_visual'?'Offscreen narration, read exactly: "'+s.script_line+'". Onscreen characters are silent; no lip-sync.':'No spoken words, narrator, dialogue, singing or lip-sync. Natural nonverbal vocalizations only when specified.';
 return [`Generate ONE standalone ${options.seconds||8}-second clip, scene ${index+1}. Internal shots are not extra clips. Aspect ${options.aspect||story.aspect_ratio}.`,
 `TOPIC: ${story.title}. Every shot must depict this topic's concrete event, objects and context.`,
 'STYLE: '+p.style,'DIRECTION: '+p.direction,'CAMERA: '+p.camera,'STYLE DNA: '+JSON.stringify(p.analysis_dna||{}),
 'IDENTITY REFERENCES: '+p.reference_cast.map(c=>'@'+c.name+': '+c.description).join('\n'),
 'LOCATION REFERENCES: '+'@'+story.place.name+': '+story.place.description+'. This is a design reference for matching shots only. Additional story locations: '+story.reference_locations.slice(1).map(l=>l.name+': '+l.description).join('; ')+'. Use the location required by this scene, never put every location in one frame.',
 'START STATE: '+s.start_state,...s.shots.map((v,i)=>`SHOT ${i+1} ${v.start_seconds}–${v.end_seconds}s: ${v.visual}`),'END STATE: '+s.end_state,speech,
 'Audio: Native generated audio. '+p.sound_style+'. Specific clip sounds: '+s.sound_context,
 'Maintain reference identities, wardrobe, props and spatial direction. References are design guides, not visible sheets. No added subtitles, logos, watermark or text unless explicitly required.'].join('\n\n')+'\n';
}
function build(p,cast,meta,scenes,{title,aspect,seconds}){
 const locations=meta.locations?.length?meta.locations:[{name:meta.place_name||'Location',description:meta.place_description||'Story-relevant environment'}];
 const story={title,description:meta.description||title,preset_id:p.id,niche:p.name,derived_video_preset:true,reference_preset:p,style:p.style,aspect_ratio:aspect,scene_seconds:seconds,total_scenes:scenes.length,narrated:p.ready_script_mode==='narrated_visual',narration_scope:p.narration_scope,silent_cast:p.ready_script_mode!=='dialogue',sound_style:p.sound_style,
 character_descriptions:Object.fromEntries(cast.map(c=>[c.name.toLowerCase(),c.description])),character_references:Object.fromEntries(cast.map(c=>[c.name.toLowerCase(),'./character_refs/'+c.name.toLowerCase()+'.jpg'])),reference_locations:locations,
 place:{name:locations[0].name,description:locations[0].description,prompt:p.style+'. Empty location, no characters or text: '+locations[0].description},
 scenes:scenes.map((c,i)=>({_scene_number:i+1,_scene_title:c.scene_title||`Clip ${i+1}`,scene_builder_action:'text_to_video',extend_from_last_frame:false,script_line:c.narration||c.script_line||'',dialogue:c.dialogue||[],characters:cast.map(c=>c.name),start_state:c.start_state,end_state:c.end_state,shots:c.shots||[],sound_context:c.sound||c.sound_context||'',narrative_context:c.action||c.narrative_context||(c.shots||[]).map(s=>s.visual).join(' ')}))};
 story.scenes.forEach((s,i)=>s.veo3_prompt=scene(story,i));return story;
}
function prepare(W,p,source,aspect){p=require('./reverse_video_contract').validatePreset(p);validate(source,p);const cast=p.reference_cast.map(c=>({...c,sheet_prompt:`${p.style}. Character reference turnaround, consistent identity, neutral background, no labels: ${c.description}`}));
 const locations=(source.locations.length?source.locations:[{name:'Location',description:source.setting}]).map(l=>({...l,name:l.name.replace(/[^A-Za-z0-9_]/g,'')}));
 if(locations.some(l=>!l.name||cast.some(c=>c.name.toLowerCase()===l.name.toLowerCase()))||new Set(locations.map(l=>l.name.toLowerCase())).size!==locations.length)throw Error('Location reference names must be unique and different from character names.');
 const story=build(p,cast,{locations,description:source.title},source.clips.map(c=>({...c,scene_title:c.title})),{title:source.title,aspect,seconds:source.seconds});story.script_import=true;return {W,p,cast,story,warnings:source.clips.filter(c=>(c.narration||c.dialogue.map(t=>t.line).join(' ')).split(/\s+/).length>24).map(c=>`Clip ${c.number}: speech may be too long for eight seconds.`)};
}
function writeRefs(dir,p,story,cast){const fs=require('fs'),path=require('path');const refs=[...cast.map(c=>({name:c.name,file:c.name.toLowerCase()+'.jpg',kind:'character',prompt:c.sheet_prompt})),...story.reference_locations.slice(0,1).map(l=>({name:l.name,file:l.name+'.jpg',kind:'place',prompt:p.style+'. Empty actual story location, no characters, no text: '+l.description}))];fs.mkdirSync(path.join(dir,'character_refs'),{recursive:true});fs.writeFileSync(path.join(dir,'refs.json'),JSON.stringify({refs},null,2)+'\n');fs.writeFileSync(path.join(dir,'character_sheets.txt'),refs.map(r=>r.name+'\n'+r.prompt).join('\n\n'));}
function agent(story,options={}){if(!applies(story))return null;const from=options.from||1,to=options.to||story.scenes.length;return `Generate exactly ${to-from+1} separate clips, scenes ${from}–${to}.\n\n`+story.scenes.slice(from-1,to).map((_,i)=>`Scene ${from+i}\n`+scene(story,from+i-1,options)).join('\n\n');}
function castPrompt(p,meta){return `Plan ${meta.count} eight-second clips. Title: ${meta.title}. Creator details: ${meta.detail}.\n${require('./reverse_video_contract').masterPrompt(p)}\nReturn JSON only: {characters:${JSON.stringify(p.reference_cast)},description:"...",moral:"...",place_name:"Location",place_description:"actual topic-specific setting",place_prompt:"empty actual location reference",locations:[{name:"Location",description:"actual setting"}],outline:[{scene_title:"...",beat:"concrete action, progression and outcome"}]}. Exactly ${meta.count} outline entries. No prose outside JSON.`;}
function scenesPrompt(p,meta,from,to){return `${require('./reverse_video_contract').masterPrompt(p)}\nWrite scenes ${from+1} to ${to} only as JSON {scenes:[{scene_title:"...",script_line:"${p.ready_script_mode==='narrated_visual'?'exact narration':''}",dialogue:[],characters:${JSON.stringify(p.reference_cast.map(c=>c.name))},start_state:"...",end_state:"...",shots:[{start_seconds:0,end_seconds:8,visual:"..."}],sound_context:"specific native audio",narrative_context:"topic-specific event"}]}. For dialogue mode fill dialogue with {speaker,line} and keep script_line empty. For silent mode both speech fields empty. One to four timed shots cover exactly 0–8. Context: ${JSON.stringify(meta)}`;}
module.exports={applies,validate,scene,build,prepare,writeRefs,agent,castPrompt,scenesPrompt};
