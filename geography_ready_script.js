'use strict';
const applies=s=>s?.geography_ready_import===true;
const visual=c=>c.shots.map((shot,i)=>`SHOT ${i+1} (${shot.start_seconds}-${shot.end_seconds}s): ${shot.visual}`).join('\n');
function scene(story,index,{aspect=story.aspect_ratio,seconds=8}={}){
 const s=story.scenes[index];
 return [`Generate ONE ${seconds}-second standalone geography-map clip for scene ${index+1}. The timed shots are internal views, not extra clips.`,
  `TOPIC: ${story.title}. ${story.imported_brief||''}`,
  `STYLE: ${story.style}. PALETTE: ${story.palette}. Aspect: ${aspect}.`,
  'MAP ACCURACY: Use recognizable real satellite geography. Preserve the exact named places, chronology, route direction and source-supported events in the supplied shots. Never invent locations, distances, routes, military actions or outcomes.',
  `LOCATION CATALOG: ${JSON.stringify(story.imported_locations||[])}. Use each location only when named or required by this scene; no single reference location is a fixed backdrop.`,
  'VISUAL AUTHORITY: Follow supplied shot subjects, actions and order exactly. For travel, retain one continuous route and cumulative progress. For wars, animate only source-supported military markers and movements. For geographic features, trace the feature accurately. Connect related map views with one readable camera move; use a motivated cut only for a real time/place change.',
  visual(s),
  `NARRATION: One consistent off-screen narrator (${story.narrator_voice||'clear energetic documentary voice'}). Read exactly: ${JSON.stringify(s.script_line)}. No character dialogue.`,
  `SOUND: ${s.sound||'None'}. Keep music and effects under narration.`,
  `AVOID: ${story.avoid}. No invented events, labels, landmarks, equipment or captions.`].join('\n\n')+'\n';
}
function agent(story,{from=1,to=story.scenes.length,...options}={}){
 if(!applies(story))return null;
 return [`Create exactly ${to-from+1} separate clips for scenes ${from}-${to}; preserve supplied narration and chronology.`,...story.scenes.slice(from-1,to).map((s,i)=>`Scene ${from+i}\n${scene(story,from+i-1,options)}`)].join('\n\n');
}
function prepare(W,p,source,aspect){
 if(source.seconds!==8)throw Error('Geography Map ready scripts currently require eight-second clips.');
 const locations=source.locations.length?source.locations:[{name:'Map locations',description:source.setting||source.story_brief||source.title}];
 const cast=[];
 const place={name:locations[0].name,description:locations[0].description,prompt:`${p.style}. Satellite map reference plate for ${locations[0].name}: ${locations[0].description}. Accurate geography, no text or invented events.`};
 const story=W.buildStory(p,cast,{description:source.story_brief||source.details||source.title,moral:'',place_name:place.name,place_description:place.description,place_prompt:place.prompt},source.clips.map(c=>({scene_title:c.title,script_line:c.narration,narrative_context:visual(c),characters:[]})));
 Object.assign(story,{geography_ready_import:true,script_import:true,narrated:true,imported_locations:locations,imported_brief:source.story_brief||source.details||'',palette:p.palette,avoid:p.avoid,sound_style:p.sound_style,source_story_number:source.storyNumber});
 story.scenes.forEach((s,i)=>{const c=source.clips[i];Object.assign(s,{script_line:c.narration,shots:c.shots,sound:c.sound||'None'});s.veo3_prompt=scene(story,i,{aspect});});
 return {W,p,cast,story,warnings:[...(source.warnings||[])]};
}
module.exports={applies,visual,scene,agent,prepare};
