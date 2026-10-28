const applies=s=>s?.zack_ready_import===true;
function visual(scene){return scene.shots.map((s,i)=>`SHOT ${i+1} (${s.start_seconds}-${s.end_seconds}s): ${s.visual}`).join('\n');}
function relevantLocations(story,scene){
 const text=scene.shots.map(s=>s.visual).join(' ').toLowerCase();
 return (story.imported_locations||[]).filter(location=>{
  if(text.includes(location.name.toLowerCase()))return true;
  const tokens=location.name.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
  const specific=tokens.filter(t=>!['primary','setting','medical','technical','environment','location','the','and'].includes(t));
  return specific.length>0&&specific.every(token=>text.includes(token));
 });
}
function scene(story,index,{aspect=story.aspect_ratio,seconds=8}={}){
 const s=story.scenes[index];
 const present=new Set((s.characters||[]).map(n=>n.toLowerCase()));
 const refs=[...(story.imported_cast||[]).filter(n=>present.has(n.toLowerCase())),story.place?.name].filter(Boolean);
 const locations=relevantLocations(story,s);
 return [`Generate ONE standalone ${seconds}-second clip for scene ${index+1} only. These shots are internal views in this one clip, not extra clips.`,
  `FILM TOPIC: ${story.title}. ${story.visual_continuity||''}`,
  require('./zack_topic_visuals').CONTRACT,
  require('./zack_camera_transitions').DIRECTION,
  `FORMAT: ${aspect==='Flow'?'Use the ratio selected in Flow':aspect}.`,
  `STYLE: ${story.style}\nPALETTE: ${story.palette}`,
  `REFERENCES: ${refs.map(n=>'@'+n).join(', ')||'None'}. Reference images hold identity and design only; do not reproduce a reference sheet as a frame.`,
  ...Object.entries(story.character_descriptions||{}).filter(([name])=>present.has(name.toLowerCase())).map(([name,description])=>`IDENTITY ${name}: ${description}`),
  `LOCATIONS: ${locations.length?JSON.stringify(locations):'Use the concrete setting described in each shot.'} A location reference does not force interiors onto exterior or diagram shots.`,
  ...(story.imported_details?[`CREATOR CONTEXT: ${story.imported_details}`]:[]),
  'SUPPLIED SHOT AUTHORITY: Preserve the supplied subjects, actions, order, timings and explicit cuts. Camera guidelines may clarify an unspecified connection; they do not rewrite these shots or invent a mechanism. Keep clean cuts when changing place, time or anatomical scale requires them.',
  'Follow the supplied shot order and timings. Connect related views with readable camera travel; cut only when spatial or temporal continuity is impossible. Clean stylised 3D rendering. Cyan-blue is a presentation colour, not permission to replace the required environment with a generic studio or machine. No invented event or additional clip. No added CTA: the supplied final clip is the ending.',
  `[SHOT]\n${visual(s)}\nEFFECT: ${s.effect||'None'}`,
  require('./zack_native_audio').instructions(story,s),
  `[AUDIO] One consistent off-screen narrator: ${story.narrator_voice}. Read this complete line exactly: ${JSON.stringify(s.script_line)}. Silent on-screen cast, mouths closed; no dialogue or lip-sync. SOUND EFFECTS: ${s.sound||'None'}. Keep effects and any specified instrumental music quiet beneath uninterrupted speech. The supplied Sound field controls this clip audio.`,
  `AVOID: ${story.avoid}`].join('\n\n')+'\n';
}
function agent(story,{from=1,to=story.scenes.length,aspect=story.aspect_ratio,seconds=8}={}){
 if(!applies(story))return null;
 return [`Create exactly ${to-from+1} separate clips for scenes ${from}-${to}, one clip per scene. Do not add, split, merge or rewrite scenes.`,...story.scenes.slice(from-1,to).map((s,i)=>`Scene ${from+i} — ${s._scene_title}\n${scene(story,from+i-1,{aspect,seconds})}`)].join('\n\n');
}
function prepare(W,p,s,aspect){
 require('./zack_topic_visuals').validate(s);
 if(s.seconds!==8)throw Error('Zack D ready scripts require eight-second clips.');
 if(s.characters.length>2)throw Error('Zack D supports at most two recurring characters.');
 const cast=W.normaliseCast(p,s.characters.map(c=>({name:c.name,type:'human',description:`IMPORTED ZACK 3D CHARACTER. ${c.description} ${p.style}. Keep the same face, proportions, hair and fixed clothing. Silent on-screen character.`,sheet_prompt:`IMPORTED ZACK 3D CHARACTER. ${p.style}. Multi-angle character identity sheet of ${c.name}: ${c.description}. Same clothing and proportions in every view. Mouth closed, plain cyan background, no text or watermark.`})));
 const locations=s.locations.length?s.locations:[{name:'Environment',description:s.setting}];
 const place=locations.map(l=>`${l.name}: ${l.description}`).join(' ');
 const story=W.buildStory(p,cast,{description:s.title,moral:'',place_name:'Environment',place_description:place,place_prompt:`${p.style}. IMPORTED ZACK 3D ENVIRONMENT. Film topic: ${s.title}. One coherent environment design reference: ${locations[0].name}: ${locations[0].description}. Render its actual architecture and relevant props. No collage of locations, invented technology, people, animals, labels, text or watermark. Other scenes use their own specified settings; this plate is not a universal scene background.`},s.clips.map(c=>({scene_title:c.title,script_line:c.narration,narrative_context:visual(c),characters:cast.filter(a=>c.shots.some(shot=>shot.visual.toLowerCase().includes(a.name.toLowerCase()))).map(a=>a.name)})));
 story.zack_ready_import=true;story.script_import=true;story.imported_locations=locations;story.imported_cast=cast.map(c=>c.name);story.palette=p.palette;story.avoid=p.avoid;story.sound_style=p.sound_style;
 if(s.continuity){story.visual_continuity=s.continuity;story.imported_continuity=s.continuity;}
 if(s.details)story.imported_details=s.details;
 if(s.storyNumber)story.source_story_number=s.storyNumber;
 if(s.production_profile)story.production_profile=s.production_profile;
 story.scenes.forEach((sc,i)=>{const c=s.clips[i];sc.script_line=c.narration;sc.shots=c.shots;sc.effect=c.effect||'None';sc.sound=c.sound||'None';sc.narrative_context=visual(sc);sc.veo3_prompt=scene(story,i,{aspect});});
 const warnings=[...(s.warnings||[])];
 return {W,p,cast,story,warnings};
}
module.exports={applies,visual,scene,agent,prepare,relevantLocations};
