const ID='heartwarming-cat-3d';
const STYLE='Polished stylized 3D feature-animation CGI, expressive rounded anatomy, PBR fabrics, soft translucent skin shading, strand-groomed plush fur, luminous emerald eye catchlights, natural squash-and-stretch, cinematic depth of field. No live action, flat 2D, toy-plastic surfaces or named franchise characters.';
const CAST=[
 {name:'Girl',gender:'female',type:'human',description:'An adult woman age 25 with voluminous wavy auburn-red hair with a side part, bright emerald-green eyes, fair peach skin, freckles across nose and cheeks, a tiny black butterfly tattoo at the left collarbone, slim natural adult proportions. Oversized pastel-pink crewneck sweatshirt, grey lounge shorts and soft house slippers. Same face, hairstyle and outfit throughout. The tattoo may be covered by the sweatshirt; never move it to another body part.'},
 {name:'Cat',gender:'male',type:'animal',description:'An extremely rotund adult ginger tabby cat with short stubby legs, a round striped tail, small folded ears, cream muzzle and paws, huge glossy emerald-green eyes and a tiny pink nose. Mandatory off-white fabric bib tied comfortably around the neck with a tiny embroidered blue fish patch. Keep orange stripes, body volume and bib in every shot. Cat locomotion and paws; expressive pantomime may hold a toy but never human hands or a human body.'}
];
const CONTRACT='Silent visual domestic storytelling: no spoken dialogue, whispers, words, narration, singing, lip-sync, subtitles, captions, logos or watermark. Cat mouth may open for a natural meow, never for words. Show a concrete emotional hook within the first 3 seconds, then escalating bids for comfort, a visible empathy realization, and a gentle cheek-to-cheek cuddle. No cruelty, punitive neglect, injury or frightening abuse. Healthy gentle animal handling and comfortable loose bib. Keep a small brown plush teddy bear tracked as a real prop, never teleporting. Two or three timed shots per 8-second clip, up to four when needed; the final embrace gets an uninterrupted 4–6 seconds. Cut on actions or reactions; no constant camera drift, orbit or filler zooms. Low cat-eye-level views, readable adult reactions, 35–50mm equivalent and shallow depth of field. Cool window ambience balanced with warm 2800–3200K lamps; any weather/time change has a visible motivated transition. Story-specific rooms within one coherent home, no universal room forced over every shot. Matching written end/start states guide continuity but independent generations do not guarantee identical boundary frames.';
const applies=p=>p?.id===ID||p?.preset_id===ID||p?.heartwarming_cat===true;
const approvedCast=(p,cast)=>applies(p)?CAST.map(c=>({...c,sheet_prompt:`${STYLE} Turnaround reference of ${c.name}: ${c.description} Front, three-quarter and profile views of the same identity, neutral grey studio background, no labels or text.`})):cast;
function validate(source){
 if(source.seconds!==8)throw Error('Heartwarming Cat uses 8-second clips. Choose a duration divisible by eight.');
 for(const [i,c] of source.clips.entries()){
  if(/(?:girl|woman|human)\s+(?:says|speaks|whispers?|whispering)\s*[:\"]/i.test(c.sound||''))throw Error(`Clip ${c.number}: human spoken or whispered words are not allowed; use silent gestures and cat sounds.`);
  if(c.dialogue.length||c.narration&&!/^none\.?$/i.test(c.narration))throw Error(`Clip ${c.number}: this preset has no narration or spoken dialogue.`);
  for(const k of ['start_state','end_state','sound'])if(!c[k]?.trim())throw Error(`Clip ${c.number}: supply Start state:, End state: and Audio: (or Sound:).`);
  if(i&&c.start_state.trim()!==source.clips[i-1].end_state.trim())throw Error(`Clip ${c.number}: Start state must exactly repeat the preceding End state; preserve positions and props.`);
  if(c.shots.length<2||c.shots.length>4)throw Error(`Clip ${c.number}: use 2–4 timed Shot N: fields.`);
  let end=0;for(const shot of c.shots){if(Math.abs(shot.start_seconds-end)>.001||shot.end_seconds<=shot.start_seconds||shot.end_seconds>8||!shot.visual.trim())throw Error(`Clip ${c.number}: shots must continuously cover 0–8 seconds.`);end=shot.end_seconds;}
  if(end!==8)throw Error(`Clip ${c.number}: timed shots must end at 8 seconds.`);
  if(i===source.clips.length-1&&c.shots.at(-1).end_seconds-c.shots.at(-1).start_seconds<4)throw Error('Final clip: reserve the last 4–6 seconds for an uninterrupted gentle cuddle.');
 }
}
function audio(story,index){
 const count=story.scenes.length,final=index===count-1;
 const phase=final?'Warm acoustic guitar, swelling gentle cinematic strings and celesta resolve into a joyful major key; contented deep cat purring.':index>=Math.floor(count*.6)?'Continue the same quiet 78 BPM theme; warm piano and celesta lift the wistful harmony toward the major-key cuddle payoff.':'Quiet wistful minor-key solo piano and fingerstyle acoustic guitar at 78 BPM, with subtle cello underscoring worry; no loud stingers.';
 return `Audio: Native Veo-generated instrumental BGM, diegetic foley and animal vocalizations. ${phase} Same musical motif, instrumentation family and approximate 78 BPM across clips; no restarted intro. Specific sounds: ${story.scenes[index].sound_context||'Soft room tone and gentle paws on wood.'} Foley/meows remain readable over restrained music. No human speech, whisper, narrator, vocal music or lyrics. Music continuity across independently generated clips may need editing.`;
}
function scene(story,index,{aspect=story.aspect_ratio||'9:16',seconds=8}={}){
 const s=story.scenes[index];if(!s)throw Error('Missing Cat story scene '+(index+1));
 return [`Generate ONE standalone ${seconds}-second clip for scene ${index+1} only. Internal shots are views within one clip, not extra output clips.`,
 `STORY: ${story.title}. FORMAT: ${aspect==='Flow'?'Flow-selected aspect ratio':aspect}. STYLE: ${story.style||STYLE}`,
 CONTRACT,`REFERENCES: @Girl, @Cat, @${story.place?.name||'Home'}. Exactly three reference images: Girl, Cat and this story location. The teddy is a prop, not a fourth reference. References establish identity and location design, not a collage or a turnaround in the video.`,
 ...CAST.map(c=>`IDENTITY ${c.name}: ${c.description}`),
 `HOME DESIGN: ${story.place?.description||''}. Use only the room relevant to this action, with matching architecture and furnishings.`,
 'START STATE: '+s.start_state,...(s.shots||[]).map((v,i)=>`SHOT ${i+1} (${v.start_seconds}–${v.end_seconds}s): ${v.visual}`),
 'END STATE: '+s.end_state,audio(story,index),index===story.scenes.length-1?'FINAL PAYOFF: keep the gentle cheek-to-cheek cuddle for the final 4–6 seconds, soft purring and joyful musical resolution. No CTA or extra ending scene.':'Carry the end state into the next clip; retain where the teddy bear, furniture and characters actually ended.'
 ].join('\n\n')+'\n';
}
function locationName(meta){
 const explicit=String(meta.place_name||'').trim();
 if(explicit&&!/^home$/i.test(explicit)){
  const name=explicit.replace(/[^A-Za-z0-9_]/g,'');
  if(!name||/^(Girl|Cat)$/i.test(name))throw Error('Location name must be distinct from Girl and Cat.');
  return name;
 }
 const description=String(meta.place_description||'');
 const room=description.match(/\b(bedroom|living\s*room|kitchen|hallway|garden)\b/i)?.[1].replace(/\s/g,'').toLowerCase();
 return {bedroom:'Bedroom',livingroom:'Livingroom',kitchen:'Kitchen',hallway:'Hallway',garden:'Garden'}[room]||'Home';
}
function build(p,cast,meta,scenes,{title,aspect,seconds}){
 const home=meta.place_description||p.setting;
 const story={title,description:meta.description||title,moral:meta.moral||'Small acts of attention create comfort and belonging.',niche:p.label,preset_id:ID,heartwarming_cat:true,style:p.style||STYLE,palette:p.palette,aspect_ratio:aspect,scene_seconds:seconds,total_scenes:scenes.length,video_duration:`${scenes.length*seconds} seconds`,narrated:false,narration_scope:'none',silent_cast:true,sound_style:p.sound_style,
 character_descriptions:Object.fromEntries(cast.map(c=>[c.name.toLowerCase(),c.description])),character_references:Object.fromEntries(cast.map(c=>[c.name.toLowerCase(),c.reference||`./character_refs/${c.name.toLowerCase()}.jpg`])),
 place:{name:locationName(meta),description:home,prompt:p.style+' Empty story location reference: '+home+'. Show this actual location and its relevant furniture, with coherent architecture, blonde oak and warm lighting when suitable. One readable scene, no collage, no people, animals, text or labels.'},
 scenes:scenes.map((s,i)=>({_scene_number:i+1,_scene_title:s.scene_title||`Clip ${i+1}`,scene_builder_action:'text_to_video',extend_from_last_frame:false,script_line:'',dialogue:[],characters:['Girl','Cat'],start_state:s.start_state||'',end_state:s.end_state||'',shots:s.shots||[],sound_context:s.sound_context||s.sound||'',narrative_context:s.narrative_context||(s.shots||[]).map((v,j)=>`SHOT ${j+1} (${v.start_seconds}-${v.end_seconds}s): ${v.visual}`).join(' ')}))};
 story.scenes.forEach((s,i)=>{s.veo3_prompt=scene(story,i,{aspect,seconds});});return story;
}
function validateStory(story,cast){
 const errors=[];
 try{validate({seconds:story.scene_seconds,clips:story.scenes.map((s,i)=>({number:i+1,start_state:s.start_state,end_state:s.end_state,shots:s.shots||[],dialogue:s.dialogue||[],narration:s.script_line,sound:s.sound_context}))});}catch(e){errors.push(e.message);}
 if(cast.length!==2||!cast.some(c=>c.name==='Girl'&&c.type==='human')||!cast.some(c=>c.name==='Cat'&&c.type==='animal'))errors.push('Use exactly Girl (adult human) and Cat (animal).');
 return errors;
}
function prepare(W,p,source,aspect){validate(source);const cast=W.normaliseCast(p,CAST);const story=build(p,cast,{description:source.title,place_name:source.location_name,place_description:source.setting},source.clips.map(c=>({scene_title:c.title,start_state:c.start_state,end_state:c.end_state,shots:c.shots,sound:c.sound})),{title:source.title,aspect,seconds:source.seconds});story.script_import=true;return {W,p,cast,story,warnings:[]};}
function agent(story,options={}){if(!applies(story))return null;const from=options.from||1,to=options.to||story.scenes.length;return `Create exactly ${to-from+1} separate clips for scenes ${from}-${to}. No narration, dialogue or extra clips.\n\n`+story.scenes.slice(from-1,to).map((_,i)=>`Scene ${from+i} — ${story.scenes[from+i-1]._scene_title}\n`+scene(story,from+i-1,options)).join('\n\n');}
function castPrompt(p,{title,detail,count,seconds,aspect}){return `Plan ${count} clips of ${seconds}s for a ${aspect} silent pantomime story titled ${title}. CREATOR DETAIL: ${detail}\n${p.direction}\n${CONTRACT}\nLOCKED CAST: ${JSON.stringify(CAST)}\nReturn JSON {"characters": [...locked cast with sheet_prompt], "description":"...", "moral":"...", "place_name":"Bedroom or the actual main story location name", "place_description":"actual room or coherent relevant home layout", "place_prompt":"empty relevant home reference", "outline":[{"scene_title":"...","beat":"visible action, reaction, outcome"}]}. Exactly three image references: Girl, Cat, and one actual story location named for example Bedroom, Livingroom or Kitchen; no teddy reference. Hook in the first 3 seconds; finale contains 4–6 seconds of cheek-to-cheek cuddle. Never write narration or dialogue.`;}
function scenesPrompt(p,cast,meta,from,to,{seconds}){return `Write clips ${from+1}–${to} of this silent pantomime story in JSON {"scenes":[...]}. ${CONTRACT}\nOUTLINE AND CONTINUITY: ${JSON.stringify(meta)}\nCAST: ${JSON.stringify(CAST)}\nEach scene has scene_title, script_line:"", dialogue:[], characters:["Girl","Cat"], start_state, end_state, narrative_context, sound_context and shots:[{start_seconds:0,end_seconds:3,visual:"..."},...]. Each ${seconds}s clip needs 2–4 timed shots with no gaps or overlaps; final shot ends at ${seconds}. Start state exactly repeats the preceding end state, including teddy location. Final story clip has a 4–6s cuddle shot. Native instrumental 78 BPM BGM: wistful minor piano/acoustic guitar and subtle cello during conflict; empathy lifts harmony, then strings/celesta/acoustic guitar resolve in major at the final hug. Every sound_context specifies instruments, mood, tempo, foley and meow/purr; never human words, voice-over or whispered reassurance. If a preceding batch end state is supplied in the context, begin exactly there.`;}
module.exports={ID,STYLE,CAST,CONTRACT,applies,approvedCast,validate,validateStory,locationName,build,prepare,scene,agent,audio,castPrompt,scenesPrompt};
