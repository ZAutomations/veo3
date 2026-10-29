const applies=s=>s?.fern_ready_import===true;
const visual=c=>c.shots.map((shot,i)=>`FRAMING ${i+1} (${shot.start_seconds}-${shot.end_seconds}s): ${shot.visual}`).join('\n');
function scene(story,index,options={}){
 const s=story.scenes[index];
 return [`Generate ONE ${options.seconds||8}-second clip for scene ${index+1}; the timed framing beats are not extra clips. Aspect ${options.aspect||story.aspect_ratio}.`,
 `FACTUAL TOPIC: ${story.title}. ${story.imported_brief||''}`,
 require('./fern_topic_visuals').CONTRACT,
 require('./fern_topic_visuals').GRAPHICS,
 require('./fern_topic_visuals').MUSIC,
 `STYLE: ${story.style}. PALETTE: ${story.palette}. Every human, including background people, is a completely faceless matte mannequin with realistic adult proportions, blank smooth head, no eyes/nose/mouth/hair, consistent role-specific clothing. No real-person likeness.`,
 `REFERENCES: ${[...(s.characters||[]),story.place.name].map(n=>'@'+n).join(', ')}. These lock designs, not a universal background. Use the actual location named in each framing beat. LOCATION CATALOG: ${JSON.stringify(story.imported_locations)}.`,
 `CONTINUITY: ${story.visual_continuity||'Keep the same role-specific wardrobe, relevant props and revisited architecture. Location/time changes must match the narration.'}`,
 'CAMERA: Choose an explicit readable path between spatially connected objects; name departure, travel and destination, then settle briefly. No generic camera filler or invented actions. Factual changes in place/time may use motivated cuts. Honor supplied shot contents and explicit cuts; do not invent geography to force an impossible unbroken take.',
 visual(s),`EFFECT: ${s.effect||'None'}`,
 `NATIVE AUDIO: One consistent off-screen narrator: ${story.narrator_voice}. Read the complete line exactly: ${JSON.stringify(s.script_line)}. All mannequins silent, mouths absent, no dialogue or lip-sync. Sound: ${s.sound||'Quiet scene ambience and restrained situation-matched instrumental BGM'}. Narration stays clear above music and ambience. No lyrics or competing voices.`,
 'No invented archival document, quotation, evidence, entry method, medical mechanism or outcome. Depict non-graphic illustrative reconstruction, never claim generated footage is archival.',
 `AVOID: ${story.avoid}`].join('\n\n')+'\n';
}
function agent(story,{from=1,to=story.scenes.length,...options}={}){
 if(!applies(story))return null;
 return [`Create exactly ${to-from+1} separate clips for scenes ${from}-${to}; preserve supplied narration and chronology.`,...story.scenes.slice(from-1,to).map((s,i)=>`Scene ${from+i}\n${scene(story,from+i-1,options)}`)].join('\n\n');
}
function prepare(W,p,source,aspect){
 if(source.seconds!==8)throw Error('Fern ready scripts currently require eight-second clips.');
 const cast=W.normaliseCast(p,source.characters.map(c=>({name:c.name,description:c.description,type:'human'})));
 const locations=source.locations.length?source.locations:[{name:'Reconstruction Environment',description:source.setting||source.clips[0].shots[0].visual}];
 const story=W.buildStory(p,cast,{description:source.story_brief||source.details||source.title,moral:'',place_name:locations[0].name,place_description:locations[0].description,place_prompt:`${p.style}. Empty environment design plate for this actual location: ${locations[0].description}. No people, text, collage or invented evidence. Other story locations keep their own settings.`},source.clips.map(c=>({scene_title:c.title,script_line:c.narration,narrative_context:visual(c),characters:cast.filter(a=>c.shots.some(s=>s.visual.toLowerCase().includes(a.name.toLowerCase()))).map(a=>a.name)})));
 Object.assign(story,{fern_ready_import:true,script_import:true,palette:p.palette,avoid:p.avoid,sound_style:p.sound_style,imported_locations:locations,imported_brief:source.story_brief||source.details||'',imported_sources:source.sources||'',visual_continuity:source.continuity||'',source_story_number:source.storyNumber});
 story.scenes.forEach((s,i)=>{const c=source.clips[i];Object.assign(s,{script_line:c.narration,shots:c.shots,effect:c.effect||'None',sound:c.sound||'None'});s.veo3_prompt=scene(story,i,{aspect});});
 return {W,p,cast,story,warnings:[...source.warnings]};
}
module.exports={applies,scene,agent,prepare};
