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
function visualContinuity(story){
 const continuity=String(story.visual_continuity||'').trim();
 return `WORLD CONTINUITY (story facts only; visual-style conflicts are resolved by the preset STYLE, PALETTE and matching reference image): ${continuity||'Preserve the story premise and consistent locations.'}. Do not let older or generic color, lighting, or rendering notes in this continuity field override the selected preset or reference look. Preserve only color details essential to the real subject (for example, a naturally colored object or a factual diagram).`;
}
function scene(story,index,{aspect=story.aspect_ratio,seconds=8}={}){
 const s=story.scenes[index];
 const present=new Set((s.characters||[]).map(n=>n.toLowerCase()));
 const refs=[...(story.imported_cast||[]).filter(n=>present.has(n.toLowerCase())),story.place?.name].filter(Boolean);
 const locations=relevantLocations(story,s);
 return [`Generate ONE standalone ${seconds}-second clip for scene ${index+1} only. These shots are internal views in this one clip, not extra clips.`,
  `FILM TOPIC: ${story.title}.\n${visualContinuity(story)}`,
  require('./zack_topic_visuals').CONTRACT,
  require('./cats_behavior_contract').forStory(story),
 require('./cats_behavior_contract').forScene(story,s),
  ...(story.preset_id==='intimacy-health-3d'?[require('./intimacy_health_contract').DIRECTION]:[]),
  require('./narration_callout_contract').forScene(story,s,seconds),
  require('./zack_camera_transitions').DIRECTION,
  require('./clip_join_camera_contract').DIRECTION,
  `FORMAT: ${aspect==='Flow'?'Use the ratio selected in Flow':aspect}.`,
  `STYLE: ${story.style}\nPALETTE: ${story.palette}`,
  `REFERENCES: ${refs.map(n=>'@'+n).join(', ')||'None'}. Treat each attached matching reference as a strong visual design anchor: match its 3D rendering language, material finish, color richness, palette balance, contrast and lighting character, while adapting the composition to the exact supplied scene. For @Environment, carry its stylized, vivid multicolour 3D look into the scene’s buildings, streets, props and lighting; do not replace it with muted photorealism, slate-blue grading or a generic cyan look. Preserve the reference’s identity and design, but do not copy its exact framing or reproduce the reference sheet as a frame.`,
  ...Object.entries(story.character_descriptions||{}).filter(([name])=>present.has(name.toLowerCase())).map(([name,description])=>`IDENTITY ${name}: ${description}`),
  `LOCATIONS: ${locations.length?JSON.stringify(locations):'Use the concrete setting described in each shot.'} A location reference does not force interiors onto exterior or diagram shots.`,
  ...(story.imported_details?[`CREATOR CONTEXT: ${story.imported_details}`]:[]),
  'SUPPLIED SHOT AUTHORITY: Preserve supplied subjects, actions, order and timings. Interpret any “cut to” wording between timed shots as an in-camera pan/whip-pan/foreground occlusion move; it does not authorize an edit cut. Do not invent a mechanism or event.',
  'Follow the supplied shot order and timings. Keep every timed shot change inside one continuous camera take using visible pan/whip-pan movement, even for a new location or anatomical scale. Apply a rich, coordinated multicolour palette across the actual subject, 3D elements, diagrams, environment and callouts; use several distinct warm and cool hues with clear hierarchy, never a cyan-only wash. Preserve the scene’s real setting and all supplied design colors. No invented event or additional clip. Do not invent or append a CTA line during generation. Preserve a supplied final viewer-question CTA exactly; an optional local finishing CTA is handled only by the editor.',
  `[SHOT]\n${visual(s)}\nEFFECT: ${s.effect||'None'}`,
  require('./zack_native_audio').instructions(story,s),
  require('./narration_pace').lock(seconds),
  `[AUDIO] One consistent off-screen narrator: ${story.narrator_voice}. This clip is exactly ${seconds} seconds; use the full selected runtime. Read this complete line exactly at the shared reference-matched pace: ${JSON.stringify(s.script_line)}. Never truncate the opening or ending, rush beyond clear articulation, add speech, or leave a long silent tail. ${story.preset_id==='cats-behavior-3d'?'Natural non-speaking animals; mouth motion only for the supplied behavior, no dialogue or narrator lip-sync.':'Silent on-screen cast, mouths closed; no dialogue or lip-sync.'} SOUND EFFECTS: ${s.sound||'None'}, plus a quiet synchronized pop/click for each required named-entity callout and soft typewriter ticks only during number reveals. Keep all effects and specified instrumental music quiet beneath uninterrupted speech; do not let callout SFX override narration or preset music identity.`,
  `AVOID: ${story.avoid}`].join('\n\n')+'\n';
}
function agent(story,{from=1,to=story.scenes.length,aspect=story.aspect_ratio,seconds=8}={}){
 if(!applies(story))return null;
 return [`Create exactly ${to-from+1} separate clips for scenes ${from}-${to}, one clip per scene. Do not add, split, merge or rewrite scenes.`,...story.scenes.slice(from-1,to).map((s,i)=>`Scene ${from+i} — ${s._scene_title}\n${scene(story,from+i-1,{aspect,seconds})}`)].join('\n\n');
}
function prepare(W,p,s,aspect){
 require('./zack_topic_visuals').validate(s);
 if(![4,6,8,10].includes(s.seconds))throw Error('Zack D supports 4, 6, 8 or 10 seconds per clip.');
 if(s.characters.length>2)throw Error('Zack D supports at most two recurring characters.');
 const catPreset=p.id==='cats-behavior-3d';
 const cast=W.normaliseCast(catPreset?{...p,_cats_import_preserve:s.characters.length>0}:p,s.characters.map(c=>({name:c.name,type:catPreset?(/\bdog\b/i.test(c.description)?'dog':/\b(human|caregiver|owner|adult (man|woman))\b/i.test(c.description)?'human':'cat'):'human',description:`IMPORTED ZACK 3D CHARACTER. ${c.description} ${p.style}. ${catPreset?'Keep species anatomy, coat markings, eye color and proportions; natural quadrupedal animals, no clothes or human hands.':'Keep the same face, proportions, hair and fixed clothing.'} Silent on-screen character.`,sheet_prompt:`IMPORTED ZACK 3D CHARACTER. ${p.style}. Multi-angle character identity sheet of ${c.name}: ${c.description}. ${catPreset?'Same species, coat markings, eye color and natural anatomy in every view; no clothes, no human hands.':'Same clothing and proportions in every view'}, rendered in full rich color. Mouth closed; use a neutral warm-grey or charcoal backdrop that makes the specified subject colors vivid, never plain cyan. No text or watermark.`})));
 const locations=s.locations.length?s.locations:[{name:'Environment',description:s.setting}];
 const place=locations.map(l=>`${l.name}: ${l.description}`).join(' ');
 const story=W.buildStory(p,cast,{description:s.title,moral:'',place_name:'Environment',place_description:place,place_prompt:`${p.style}. IMPORTED ZACK 3D ENVIRONMENT. Film topic: ${s.title}. One coherent environment design reference: ${locations[0].name}: ${locations[0].description}. Render its actual architecture and relevant props. No collage of locations, invented technology, people, animals, labels, text or watermark. Other scenes use their own specified settings; this plate is not a universal scene background.`},s.clips.map(c=>({scene_title:c.title,script_line:c.narration,narrative_context:visual(c),characters:cast.filter(a=>c.shots.some(shot=>shot.visual.toLowerCase().includes(a.name.toLowerCase())||(catPreset&&!s.characters.length&&a.name==='Milo'&&/\b(cat|tabby|kitten)\b/i.test(shot.visual)))).map(a=>a.name)})));
 story.zack_ready_import=true;story.script_import=true;story.scene_seconds=s.seconds;story.total_scenes=s.clips.length;story.duration=`${s.seconds*s.clips.length} seconds`;story.imported_locations=locations;story.imported_cast=cast.map(c=>c.name);story.palette=p.palette;story.avoid=p.avoid;story.sound_style=p.sound_style;
 if(s.continuity){story.visual_continuity=s.continuity;story.imported_continuity=s.continuity;}
 if(s.details)story.imported_details=s.details;
 if(s.storyNumber)story.source_story_number=s.storyNumber;
 if(s.production_profile)story.production_profile=s.production_profile;
 story.scenes.forEach((sc,i)=>{const c=s.clips[i];sc.script_line=c.narration;sc.shots=c.shots;sc.effect=c.effect||'None';sc.sound=c.sound||'None';sc.narrative_context=visual(sc);sc.veo3_prompt=scene(story,i,{aspect,seconds:s.seconds});});
 const warnings=[...(s.warnings||[])];
 return {W,p,cast,story,warnings};
}
module.exports={applies,visual,scene,agent,prepare,relevantLocations,visualContinuity};
