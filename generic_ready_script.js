'use strict';
const SPECIAL=new Set(['world-politics-map-explain','fern-documentary','3d-zack-style','intimacy-health-3d','geography-map','3d-motivational-red-green','heartwarming-cat-3d','relationship-dialogue-real','relationship-dialogue-ghibli','relationship-dialogue-3d','relationship-dialogue-colorful-cartoon','relationship-dialogue-dog-couple']);
const appliesPreset=p=>!!p&&!p.derived_video_preset&&!SPECIAL.has(p.id);
const mode=p=>p.narration_scope==='dialogue'?'dialogue':p.narration_scope==='none'?'silent':p.narration_scope==='intro'?'intro':'narrated';
const applies=s=>s?.generic_ready_import===true;
function validate(source,p){
 const speech=mode(p),names=new Set(source.characters.map(c=>c.name.toLowerCase()));
 for(const name of Object.values(p.fixed_couple_names||{}))names.add(name.toLowerCase());
 if(p.single_speaker_advice)names.add('lilly');
 for(const c of source.clips){
  if(speech==='dialogue'){
   if(!c.dialogue.length||c.narration)throw Error(`Clip ${c.number}: use named character dialogue only, without Narration.`);
   for(const t of c.dialogue){
    if(!names.has(t.speaker.toLowerCase()))throw Error(`Clip ${c.number}: speaker ${t.speaker} needs a matching Characters entry.`);
    if(p.single_speaker_advice&&t.speaker!=='Lilly')throw Error(`Clip ${c.number}: only Lilly speaks; Pip remains silent.`);
   }
  }else if(c.dialogue.length||((speech==='narrated'||speech==='intro'&&c.number===1)&&!c.narration)||((speech==='silent'||speech==='intro'&&c.number>1)&&c.narration))throw Error(`Clip ${c.number}: speech does not match this preset's ${speech} mode.`);
  if(!c.shots.length||c.shots.length>4)throw Error(`Clip ${c.number}: supply one to four timed Shot fields.`);
  let end=0;for(const s of c.shots){if(s.start_seconds!==end||s.end_seconds<=end||s.end_seconds>source.seconds)throw Error(`Clip ${c.number}: shot timings have a gap, overlap or invalid endpoint.`);end=s.end_seconds;}
  if(end!==source.seconds)throw Error(`Clip ${c.number}: shots must cover exactly ${source.seconds} seconds.`);
  if(c.narration&&require('./narration_pace').countWords(c.narration)>require('./narration_pace').targets(source.seconds).hard)throw Error(`Clip ${c.number}: narration exceeds the ${require('./narration_pace').targets(source.seconds).hard}-word ceiling for ${source.seconds} seconds.`);
 }
}
function scene(story,index,{seconds=story.scene_seconds,aspect=story.aspect_ratio}={}){
 const s=story.scenes[index],p=story.imported_preset;
 const names=s.characters||[];
 const speech=s.dialogue?.length?`Only named speakers deliver these exact turns, leaving 0.30 seconds between voices; listeners remain silent. No narrator. ${p.dialogue_delivery||''}\n`+s.dialogue.map(t=>`${t.speaker}: ${JSON.stringify(t.line)}`).join('\n'):s.script_line?require('./narration_pace').lock(seconds)+`\nOne consistent off-screen narrator (${story.narrator_voice||'established documentary/storyteller voice'}${story.flow_voice?'; Flow voice '+story.flow_voice:''}) reads exactly: ${JSON.stringify(s.script_line)}. Visible characters remain silent.`:'No narration, dialogue, singing or invented speech. Only the supplied sound design and permitted nonverbal vocalizations.';
 return [`Generate ONE ${seconds}-second clip for scene ${index+1}, aspect ${aspect}. Timed shots are internal beats, not extra output clips.`,
 `STYLE: ${p.style}. PALETTE: ${p.palette||'the preset palette'}. AVOID: ${p.avoid||''}`,
 `PRESET DIRECTION: ${p.direction||''}. CAMERA: ${p.camera||'Use the supplied shot framing and motivated movement.'}. Explicit selected duration and supplied timeline override older fixed-duration examples in these authoring notes. Preserve locked camera rules.`,
 `IDENTITY REFERENCES: ${names.map(n=>'@'+n+': '+(story.character_descriptions?.[n.toLowerCase()]||story.character_descriptions?.[n]||'match the approved design')).join('\n')||'No human reference required.'}`,
 `LOCATION DESIGN REFERENCES: ${JSON.stringify(story.imported_locations)}. Use the actual location required by this clip; a reference is not a universal backdrop. ${p.setting?'This preset locks the setting: '+p.setting:''}`,
 story.visual_continuity?`CONTINUITY: ${story.visual_continuity}`:'',s.start_state?'START STATE: '+s.start_state:'',
 ...s.shots.map((v,i)=>`SHOT ${i+1} (${v.start_seconds}-${v.end_seconds}s): ${v.visual}`),s.end_state?'END STATE: '+s.end_state:'',
 s.imported_action?'ACTION: '+s.imported_action:'',`EFFECT: ${s.effect||'None'}`,speech,
 `NATIVE AUDIO: ${p.sound_style||'Consistent natural ambience below the supplied speech; do not invent music.'} CLIP SOUND: ${s.sound||'None'}. Honor explicit No music.`,
 require('./narration_callout_contract').forScene(story,s,seconds),
 'Preserve supplied facts, character identities, speaker ownership, wardrobe and visual medium. Do not invent dialogue, events or extra clips.'].filter(Boolean).join('\n\n')+'\n';
}
function prepare(W,p,source,aspect){
 validate(source,p);
 p={...p,generic_ready_import:true};
 let entries=source.characters.map(c=>({...c,type:/\b(?:frog|cat|dog|bird|animal|pet|wolf|bear)\b/i.test(c.description)?'animal':'human'}));
 if(!entries.length&&p.fixed_couple_names)entries=Object.entries(p.fixed_couple_names).map(([gender,name])=>({name,gender,type:'human',description:`Original adult ${gender} character in the selected preset's medium.`}));
 if(p.single_speaker_advice&&!entries.length)entries=[{name:'Lilly',type:'human',description:p.cast_idiom},{name:'Pip',type:'animal',description:'Small emerald-green frog with tiny gold crown; silent.'}];
 const cast=W.normaliseCast(p,entries);
 const locations=source.locations.length?source.locations:[{name:p.setting_name||'Environment',description:source.setting}];
 const story=W.buildStory(p,cast,{description:source.story_brief||source.details||source.title,moral:'',place_name:locations[0].name,place_description:locations[0].description,place_prompt:`${p.location_medium||p.style}. Empty design reference of ${locations[0].description}; no characters, text or collage. Other locations keep their own designs.`},source.clips.map(c=>({scene_title:c.title,script_line:c.narration||'',dialogue:c.dialogue,narrative_context:c.shots.map((v,i)=>`SHOT ${i+1} (${v.start_seconds}-${v.end_seconds}s): ${v.visual}`).join('\n'),characters:cast.map(c=>c.name)})));
 Object.assign(story,{generic_ready_import:true,script_import:true,imported_preset:p,scene_seconds:source.seconds,total_scenes:source.clips.length,duration:`${source.clips.length*source.seconds} seconds`,imported_locations:locations,imported_sources:source.sources||'',visual_continuity:source.continuity||'',source_story_number:source.storyNumber});
 story.scenes.forEach((s,i)=>{const c=source.clips[i];Object.assign(s,{script_line:c.narration||'',dialogue:c.dialogue,shots:c.shots,start_state:c.start_state,end_state:c.end_state,imported_action:c.action,effect:c.effect||'None',sound:c.sound||'None'});s.veo3_prompt=scene(story,i,{aspect,seconds:source.seconds});});
 return {W,p,cast,story,warnings:[...(source.warnings||[])]};
}
function agent(story,{from=1,to=story.scenes.length,...options}={}){
 if(!applies(story))return null;
 return [`Create exactly ${to-from+1} separate clips for scenes ${from}-${to}. Preserve exact narration/dialogue, IDs, visual identity and requested settings.`,...story.scenes.slice(from-1,to).map((s,i)=>`Scene ${from+i}\n${scene(story,from+i-1,options)}`)].join('\n\n');
}
module.exports={appliesPreset,mode,applies,validate,scene,prepare,agent};
