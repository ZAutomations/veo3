const fs=require('fs'),path=require('path');
const AUDIO='Generate an off-screen narrator voice-over in every clip. Use one consistent warm, clear adult storyteller voice, calm and compassionate, at a comfortably audible normal volume from the first word. Finish the complete line at a natural pace. On-screen characters remain silent: no character dialogue, talking, speech, singing or lip-sync; keep their mouths naturally closed. Show emotions through eyes, eyebrows, facial reactions, body language and concrete actions. Do not portray anyone delivering narration to the camera. No music, subtitles, speech bubbles or embedded text. The narrator is the only speaking voice.';
const applies=p=>p?.id==='relationship-narration-colorful-cartoon'||p?.niche==='Colorful Cartoon – Relationship Narration';
const SHOTS='Use two or three distinct timed shots within this single clip; up to four when separate narration beats need them. These are internal cuts, not extra output clips. Synchronize each shot with the corresponding narrator phrase. Cut between concrete actions, reactions and meaningful prop inserts; no continuous camera orbit or filler zooms.';
function approvedCast(p,characters){
 if(!applies(p)||!p.approved_cartoon_cast)return characters;
 return (characters||[]).map(c=>{
  const approved=p.approved_cartoon_cast.find(a=>a.name.toLowerCase()===String(c.name||'').toLowerCase())
   ||p.approved_cartoon_cast.find(a=>a.gender===String(c.gender||'').toLowerCase());
  if(!approved)return c;
  return {...c,...approved,type:'human',sheet_prompt:`${p.style} Multi-angle reference sheet of ${approved.name}. ${approved.description} Front, three-quarter, profile and full-body views of the same adult, same outfit in every view; plain off-white background. Naturally closed mouth, no text or labels.`};
 });
}
function visual(s){
 if(/SHOT 1 \(/.test(s.narrative_context||''))return s.narrative_context;
 const shots=Array.isArray(s.shots)?s.shots:[];
 return [s.narrative_context||'',...shots.map((shot,i)=>`SHOT ${i+1} (${shot.start_seconds}-${shot.end_seconds}s), narration cue ${JSON.stringify(shot.narration_cue||'')}: ${shot.visual}`)].filter(Boolean).join('\n');
}
function validateShots(story){
 if(!applies(story))return [];
 const errors=[],seconds=Number(story.scene_seconds)||8;
 for(const [i,s] of (story.scenes||[]).entries()){
  if(String(s.script_line||'').trim().split(/\s+/).filter(Boolean).length<Math.round(seconds*2.2))errors.push(`clip ${i+1}: narration is too sparse for the requested duration; write fuller linked narration`);
  const shots=s.shots||[];
  if(shots.length<2||shots.length>4){errors.push(`clip ${i+1}: requires two to four timed internal shots`);continue;}
  let end=0;
  for(const shot of shots){
   if(!Number.isFinite(shot.start_seconds)||!Number.isFinite(shot.end_seconds)||Math.abs(shot.start_seconds-end)>.05||shot.end_seconds<=shot.start_seconds||shot.end_seconds>seconds||!String(shot.visual||'').trim()||!String(shot.narration_cue||'').trim())errors.push(`clip ${i+1}: invalid shot timing or missing visual/narration cue`);
   if(shot.narration_cue&&!String(s.script_line||'').toLowerCase().includes(String(shot.narration_cue).toLowerCase()))errors.push(`clip ${i+1}: shot narration cue is not in the spoken script`);
   end=shot.end_seconds;
  }
  if(Math.abs(end-seconds)>.05)errors.push(`clip ${i+1}: shot timings must cover ${seconds} seconds exactly`);
 }
 return errors;
}
function audio(story,scene){
 const line=String(scene.script_line||'').trim();
 if(!line)throw Error('Narrated cartoon scene requires a script_line.');
 return `${AUDIO}\nNARRATOR VOICE: ${story.narrator_voice||story.narration_voice||'Warm, clear, compassionate adult storyteller.'}\nNARRATION (off-screen voice-over, read exactly): ${JSON.stringify(line)}`;
}
function cast(p,c){
 return `Write the cast and outline for a narrated relationship story titled ${JSON.stringify(c.title)}.
CREATOR DETAILS: ${c.detail}
SOURCE CONTENT: ${JSON.stringify(c.source||{})}
${c.count} scenes, ${c.seconds} seconds each, aspect ${c.aspect}.
STYLE: ${p.style}
STORY DIRECTION: ${p.direction}
Use exactly these two approved recurring cartoon adults, preserving their names, faces, eye colours, hairstyles, full outfits and colours: ${JSON.stringify(p.approved_cartoon_cast||[])}. They act naturally, with expressions following the story; no permanent smile. Do not substitute the Sarah/SAM identities from other presets. Match uploaded reference images; text alone cannot encode an exact face.
Characters and meaningful props are coloured. Room or street architecture, furniture and incidental scenery are exclusively light grey and off-white with fine grey linework. Use a bright grey-and-white location reference, no people in its plate. Colour only a plot-relevant object when the scene requires it.
Design one consistent setting appropriate to this story; characters can walk, act and interact naturally. No frozen conversation posture. Mouths stay closed in reference images too.
The narrator tells what happened, using he/she/they and the story's viewpoint. Start with an interesting hook, develop specific cause and consequence, finish with a grounded relationship lesson and a brief relevant question for viewers. No unsupported claims or victim blaming.
Veo/Flow generates the narrator audio together with the visuals in every clip. ${AUDIO}
${SHOTS} Plan two or three narration beats per clip, rather than one thin generic sentence.
Return ONLY JSON with description, moral, target_audience, thumbnail:{headline,visual_concept}, place_name, place_description, place_prompt, characters:[{name,gender,type:"human",description,sheet_prompt}], outline:[{scene_title,beat,visual}]. Exactly ${c.count} outline entries. Sheet prompts request one multi-angle identity reference with matching outfit and closed mouth. All subjects are adults.`;
}
function scenes(p,c){
 return `Write ONLY scenes ${c.from}-${c.to} of ${c.count} for ${JSON.stringify(c.title)}.
CREATOR DETAILS: ${c.detail}
SOURCE: ${JSON.stringify(c.source||{})}
CAST: ${JSON.stringify(c.cast)}
OUTLINE: ${JSON.stringify(c.outline)}
PREVIOUS SCENES: ${JSON.stringify(c.previous||[])}
LOCATION: ${c.place}
STYLE: ${p.style}
DIRECTION: ${p.direction}
Write script_line as fuller natural off-screen narration generated by Veo with each clip, roughly ${Math.round(c.seconds*2.5)}-${Math.round(c.seconds*3)} words per ${c.seconds}-second clip. Usually use two connected short sentences or two to three concrete clauses, not one sparse sentence followed by dead air. Do not cram four long spoken sentences into eight seconds. Preserve the creator's plot and speaker meaning when converting a conversation into narration. Each clip advances the story once; no repeated generic advice. Fit complete sentences at an engaging clear conversational pace, without rushing or clipping words. Never invent source events.
${SHOTS} Include a shots array of two to four entries with start_seconds, end_seconds, narration_cue (the exact phrase illustrated), and visual. Timings are continuous from zero through ${c.seconds} seconds without gaps or overlaps. For eight seconds: two shots 0-4/4-8, three shots 0-2.5/2.5-5/5-8, or four shots 0-2/2-4/4-6/6-8. Choose timing by the spoken phrase lengths. Four shots are visual beats, not four required spoken sentences.
Write narrative_context as the concrete overall action, with each shot showing its own meaningful event. Keep faces, hair, outfits and body proportions consistent. Colour main characters and meaningful props only; background light grey/off-white with fine grey linework. Mouths naturally closed, even when reacting.
Keep spoken narration ONLY in script_line, not quoted or instructed in narrative_context. Do not include dialogue fields. ${AUDIO}
Return ONLY {"scenes":[{"scene_title":"","script_line":"","narrative_context":"","shots":[{"start_seconds":0,"end_seconds":4,"narration_cue":"exact phrase","visual":"specific action"},{"start_seconds":4,"end_seconds":8,"narration_cue":"exact phrase","visual":"specific reaction"}],"characters":["cast name"]},...]} with exactly ${c.to-c.from+1} clips. Adjust example timings to the requested duration.`;
}
function scene(story,index,{aspect,seconds}={}){
 const s=story.scenes[index],names=s.characters?.length?s.characters:Object.keys(story.character_descriptions||{});
 const refs=[...names,story.place?.name].filter(Boolean);
 return [`Scene ${s._scene_number||index+1} - ${s._scene_title||s.scene_title||''}`,
 `FORMAT: ${aspect||story.aspect_ratio||'9:16'}; ${seconds||story.scene_seconds||8} seconds.`,
 `STYLE: ${story.style}`,`REFERENCES: ${refs.map(n=>'@'+n).join(', ')}`,
 ...names.map(n=>`IDENTITY ${n}: ${story.character_descriptions?.[n.toLowerCase()]||story.character_descriptions?.[n]||'Match the reference image.'}`),
 story.place?`LOCATION: ${story.place.description}`:'',
 SHOTS,`VISUAL: ${visual(s)}`,`AUDIO: ${audio(story,s)}`].filter(Boolean).join('\n');
}
function agent(story,options={}){
 if(!applies(story))return null;
 const from=options.from||1,to=options.to||story.scenes.length;
 return [`Generate ${to-from+1} separate narrated clips with audio, scenes ${from}-${to} only, one per scene. Do not repeat earlier scenes or generate later scenes.`,AUDIO,
 ...story.scenes.slice(from-1,to).map((s,i)=>scene(story,from-1+i,options))].join('\n\n');
}
function writeNarration(dir,story){
 if(!applies(story))return;
 const duration=Number(story.scene_seconds)||8;
 const segments=story.scenes.map((s,i)=>({scene:i+1,start_seconds:i*duration,end_seconds:(i+1)*duration,text:s.script_line}));
 fs.writeFileSync(path.join(dir,'NARRATION_SCRIPT.txt'),segments.map(s=>`SCENE ${String(s.scene).padStart(3,'0')} (${s.start_seconds}-${s.end_seconds}s)\n${s.text}`).join('\n\n')+'\n');
 fs.writeFileSync(path.join(dir,'narration_segments.json'),JSON.stringify({delivery:'generated-with-clips',voice_direction:story.narrator_voice,segments},null,2)+'\n');
}
module.exports={AUDIO,SHOTS,audio,applies,approvedCast,visual,validateShots,cast,scenes,scene,agent,writeNarration};
