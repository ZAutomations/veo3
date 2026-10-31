'use strict';
const fs=require('fs'),path=require('path');
const ID='reference-cinematic-sarah-sam';
const applies=p=>p?.cinematic_story_preset===true;
const safe=n=>/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(n)&&! /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(n);
function validate(source){
 if(source.seconds!==8)throw Error('Sarah & SAM cinematic scripts require Clip seconds: 8.');
 if(!source.clips.length||source.clips.length>500)throw Error('Use 1–500 eight-second clips.');
 for(const [kind,items] of [['character',source.characters],['location',source.locations]]){
  if(!items?.length)throw Error('Supply named '+kind+' descriptions.');
  for(const item of items)if(!safe(item.name)||!item.description?.trim())throw Error('Use unique simple asset names and complete '+kind+' descriptions.');
 }
 const all=[...source.characters,...source.locations].map(c=>c.name.toLowerCase());
 if(new Set(all).size!==all.length)throw Error('Character and location names must be unique, including case.');
 const cast=source.characters.map(c=>c.name),locations=source.locations.map(l=>l.name);
 if(!cast.includes('Sarah')||!cast.includes('SAM'))throw Error('Main character sheets must include Sarah and SAM with these exact spellings.');
 for(let i=0;i<source.clips.length;i++){
  const c=source.clips[i];
  if(!Array.isArray(c.characters)||c.characters.length>2||new Set(c.characters).size!==c.characters.length||c.characters.some(n=>!cast.includes(n)))throw Error(`Clip ${c.number}: Characters: must name zero to two declared visible characters, or None.`);
  if(!locations.includes(c.location))throw Error(`Clip ${c.number}: Location: must name one declared location.`);
  if(!['continuous','cut','time jump'].includes(c.transition))throw Error(`Clip ${c.number}: Transition: must be continuous, cut or time jump.`);
  if(!c.action||!c.start_state||!c.end_state||!c.sound)throw Error(`Clip ${c.number}: supply Action:, Start state:, End state: and Audio:.`);
  if(i&&c.transition==='continuous'&&(c.start_state!==source.clips[i-1].end_state||c.location!==source.clips[i-1].location))throw Error(`Clip ${c.number}: continuous Start state must exactly repeat previous End state and keep the same location.`);
  if(c.narration&&c.dialogue.length)throw Error(`Clip ${c.number}: use dialogue or narration, not both in one eight-second clip.`);
  for(const t of c.dialogue)if(!cast.includes(t.speaker)||!t.offscreen&&!c.characters.includes(t.speaker))throw Error(`Clip ${c.number}: visible speaker must be listed in Characters; use Voice Name: for a declared offscreen speaker.`);
  if(!c.shots.length||c.shots.length>4)throw Error(`Clip ${c.number}: supply one to four timed shots.`);
  let end=0;for(const shot of c.shots){if(shot.start_seconds!==end||shot.end_seconds<=end||shot.end_seconds>8)throw Error(`Clip ${c.number}: shots must cover 0–8 without gaps or overlaps.`);end=shot.end_seconds;}
  if(end!==8)throw Error(`Clip ${c.number}: shots must end at 8 seconds.`);
 }
}
function scene(story,index,options={}){
 const s=story.scenes[index],p=story.reference_preset,seconds=Number(options.seconds||8);
 if(seconds!==8)throw Error('This cinematic preset requires eight-second generation settings.');
 const location=story.reference_locations.find(l=>l.name===s.location);
 const speakers=[...new Set((s.dialogue||[]).map(t=>t.speaker))];
 const identities=[...new Set([...s.characters,...speakers])].map(n=>`${n}: ${story.character_descriptions[n.toLowerCase()]}`);
 const speech=s.dialogue.length?s.dialogue.map(t=>`${t.speaker}${t.offscreen?' (voice only, offscreen; do not show this character)':' (visible speaking character; natural lip-sync)'}: ${JSON.stringify(t.line)}`).join('\n'):s.script_line?'OFFSCREEN NARRATOR, read exactly: '+JSON.stringify(s.script_line):'No dialogue, narration or singing. Natural nonverbal sounds only as specified.';
 return [`Generate ONE standalone eight-second clip, scene ${index+1}. Aspect: ${options.aspect||story.aspect_ratio}. Internal shots are not additional clips.`,
  `FILM: ${story.title}. Timeline ${index*8}–${(index+1)*8} seconds.`,
  `STYLE: ${p.style}\nCAMERA: ${p.camera}\nDIRECTION: ${p.direction}`,
  'ATTACH ONLY THESE REFERENCES FOR THIS CLIP: '+s.reference_names.map(n=>'@'+n).join(', ')+'. Never attach every film reference to one clip. Sheets establish design; do not show a sheet or collage in the video.',
  `VISIBLE CHARACTERS: ${s.characters.join(', ')||'None'}. Do not insert absent leads or offscreen speakers.`,...identities,
  `LOCATION: ${location.name}: ${location.description}. Respect this shot location, not the film’s first location.`,
  `TRANSITION: ${s.transition}. START STATE: ${s.start_state}`,
  ...s.shots.map((v,i)=>`SHOT ${i+1}, ${v.start_seconds}–${v.end_seconds}s: ${v.visual}`),
  `ACTION: ${s.narrative_context}\nEND STATE: ${s.end_state}`,
  'SPEECH: '+speech,
  'Preserve each named voice from its character description. Only the current visible speaker moves their mouth for speech. Silent visible characters keep natural closed mouths. Leave 0.30 seconds between speaker turns. Do not rush, overlap, add or rewrite lines. Lip-sync must be reviewed after generation; a prompt is not a guarantee.',
  'AUDIO: Native generated audio. '+p.sound_style+' Clip audio: '+s.sound_context,
  'Maintain faces, hair, wardrobe, prop ownership, injuries, eyelines and screen direction. Repeat scene-specific changes in start/end state. No added text, captions, logos or watermark. End on the stated composition; no extra ending or CTA.'
 ].join('\n\n')+'\n';
}
function prepare(W,p,source,aspect){
 validate(source);
 const cast=source.characters.map(c=>({...c,type:/\banimal\b/i.test(c.description)?'animal':'human',gender:c.name==='Sarah'?'female':c.name==='SAM'?'male':'unspecified',sheet_prompt:`${p.style}. Identity reference of ${c.name}: ${c.description}. Same single character in front, three-quarter and profile views, exact identity and any specified wardrobe in every view, plain neutral background. No other characters, labels, logo or text.`}));
 const effective={...p,reference_cast:cast};
 const story={title:source.title,description:source.title,preset_id:p.id,niche:p.name,derived_video_preset:true,cinematic_story_preset:true,reference_preset:effective,style:p.style,aspect_ratio:aspect,scene_seconds:8,total_scenes:source.clips.length,duration:source.clips.length*8,script_import:true,narrated:source.clips.some(c=>c.narration),narration_scope:'mixed',silent_cast:false,sound_style:p.sound_style,
  character_descriptions:Object.fromEntries(cast.map(c=>[c.name.toLowerCase(),c.description])),character_references:Object.fromEntries(cast.map(c=>[c.name.toLowerCase(),'./character_refs/'+c.name.toLowerCase()+'.jpg'])),reference_locations:source.locations,
  place:{...source.locations[0],prompt:`${p.style}. Empty location design reference: ${source.locations[0].description}. No people, text or collage.`},
  scenes:source.clips.map((c,i)=>({_scene_number:i+1,_scene_title:c.title||`Clip ${i+1}`,scene_builder_action:'text_to_video',extend_from_last_frame:false,script_line:c.narration||'',dialogue:c.dialogue,characters:c.characters,location:c.location,reference_names:[...c.characters,c.location],transition:c.transition,start_state:c.start_state,end_state:c.end_state,shots:c.shots,sound_context:c.sound,narrative_context:c.action}))};
 story.scenes.forEach((s,i)=>s.veo3_prompt=scene(story,i));
 const warnings=source.clips.flatMap(c=>{const count=(c.narration||c.dialogue.map(t=>t.line).join(' ')).split(/\s+/).filter(Boolean).length;return count>22?[`Clip ${c.number}: ${count} spoken words may be too long for eight seconds; review before generation.`]:[];});
 return {W,p:effective,cast,story,warnings};
}
function writeRefs(dir,p,story,cast){
 const refs=[...cast.map(c=>({name:c.name,file:c.name.toLowerCase()+'.jpg',kind:'character',prompt:c.sheet_prompt})),...story.reference_locations.map(l=>({name:l.name,file:l.name+'.jpg',kind:'place',prompt:`${p.style}. ONE empty coherent location design reference of ${l.name}: ${l.description}. Wide view with architecture and important fixed props readable. No people, animals, labels, watermark, text or collage.`}))];
 fs.mkdirSync(path.join(dir,'character_refs'),{recursive:true});
 fs.writeFileSync(path.join(dir,'refs.json'),JSON.stringify({refs},null,2)+'\n');
 fs.writeFileSync(path.join(dir,'character_sheets.txt'),refs.map(r=>`=== ${r.kind==='place'?'PLACE - ':''}${r.name} ===\nsave as: character_refs/${r.file}\n\n-- image prompt --\n${r.prompt}`).join('\n\n')+'\n');
 const ledger=story.scenes.map((s,i)=>({clip:i+1,start_seconds:i*8,end_seconds:(i+1)*8,visible_characters:s.characters,location:s.location,transition:s.transition,start_state:s.start_state,end_state:s.end_state,references:s.reference_names,dialogue:s.dialogue,narration:s.script_line,audio:s.sound_context}));
 fs.writeFileSync(path.join(dir,'CONTINUITY_LEDGER.json'),JSON.stringify({title:story.title,duration_seconds:story.duration,characters:story.character_descriptions,locations:story.reference_locations,clips:ledger},null,2)+'\n');
 fs.writeFileSync(path.join(dir,'PRODUCTION_REVIEW.txt'),`Before generating: confirm duration (${story.total_scenes} × 8 = ${story.duration}s), ratio, model, cast sheets, per-scene references and voice descriptions.\nGenerate References creates image assets from refs.json; import creates prompts only.\nUse Agent or Single Scene generation for scene-specific cast/locations. Ingredients Extend can carry the prior frame into a different location; do not treat it as a universal cinematic scene-change route.\nAfter generation: check identity, wardrobe, props, mouth timing, voice consistency, 0.30s speaker gaps, start/end states, frame direction, audio joins and actual clip duration. Retry only failed/incorrect selected clips.\nJoin only after verified story-to-download mapping. Inspect final sound levels and music continuity; per-clip native music may require editing.\nSEO and thumbnail are separate from the import script.\n`);
}
module.exports={ID,applies,validate,scene,prepare,writeRefs};
