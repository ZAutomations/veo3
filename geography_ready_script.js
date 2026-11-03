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
  'NARRATION-TO-VISUAL OBJECT LOCK: Every important concrete noun in the exact narration must appear as a recognizable, topic-appropriate map object, icon, badge, vehicle or evidence marker; every important verb must receive a visible animation. A route or firing line shows direction only and must never replace a named physical object. If the narration says missiles are fired, visibly show the missiles themselves as distinct small recognizable silhouettes. If the launch point is known, animate them leaving it with a brief restrained ignition flash and exhaust, then moving along the stated direction. If it is not named, show them already in flight entering from the frame edge toward the named area; do not invent a base or launcher. The trajectory line is supplementary. If it says multiple missiles, show multiple separate missiles with readable spacing, not one line. Show a brief non-graphic fire/impact flare at the named destination only when a strike or impact is explicitly stated. Do not invent launchers, targets, hit counts, damage, casualties or destruction. Apply the same rule to named tanks, aircraft, ships and other objects: render and animate the named object, not just an arrow or line. Badges/icons must point to the exact narration-relevant area, appear at that beat, and clear afterward; use no generic decorative icons. Keep combat effects non-graphic and subordinate to geographic clarity.',
  'EXACT NUMBER AND DATE CALLOUTS: For every year, date, count, distance, percentage, age, or other numeric fact spoken in this clip, show a clean animated on-screen callout at the corresponding narration beat. Copy the value exactly from the narration; convert spoken number words to standard digits (for example, “four” → “4”, “five thousand” → “5,000”) and preserve years such as “1954” exactly. Keep wording to the exact number plus, only when useful, its correctly spelled unit or short noun. Use large, flat, high-contrast, front-facing typography with a simple fade/slide/pop entrance and a steady readable hold; animate the map marker or route around it, never scramble or transform the text. No extra figures, misspellings, malformed glyphs, digit swaps, flicker, perspective warping, or decorative text. If a longer phrase may render inaccurately, display only the exact digits and let the map carry the explanation. Do not add text when the narration contains no number.',
  visual(s),
  `NARRATION: One consistent off-screen narrator (${story.narrator_voice||'clear energetic documentary voice'}). Read exactly: ${JSON.stringify(s.script_line)}. No character dialogue.`,
  `SOUND: ${s.sound||'None'}. Keep music and effects under narration.`,
  `AVOID: ${story.avoid}. No invented events, labels, landmarks, equipment or captions, except the exact numeric/date callouts required above.`].join('\n\n')+'\n';
}
function agent(story,{from=1,to=story.scenes.length,...options}={}){
 if(!applies(story))return null;
 const seconds=options.seconds||story.scene_seconds||8;
 return [`Create exactly ${to-from+1} separate ${seconds}-second clips for scenes ${from}-${to}; preserve supplied narration and chronology.`,...story.scenes.slice(from-1,to).map((s,i)=>`Scene ${from+i}\n${scene(story,from+i-1,{...options,seconds})}`)].join('\n\n');
}
function prepare(W,p,source,aspect){
 if(![4,6,8,10].includes(source.seconds))throw Error('Geography Map supports 4, 6, 8 or 10 seconds per clip.');
 const locations=source.locations.length?source.locations:[{name:'Map locations',description:source.setting||source.story_brief||source.title}];
 const cast=[];
 const place={name:locations[0].name,description:locations[0].description,prompt:`${p.style}. Satellite map reference plate for ${locations[0].name}: ${locations[0].description}. Accurate geography, no text or invented events.`};
 const story=W.buildStory(p,cast,{description:source.story_brief||source.details||source.title,moral:'',place_name:place.name,place_description:place.description,place_prompt:place.prompt},source.clips.map(c=>({scene_title:c.title,script_line:c.narration,narrative_context:visual(c),characters:[]})));
 Object.assign(story,{geography_ready_import:true,script_import:true,narrated:true,scene_seconds:source.seconds,total_scenes:source.clips.length,duration:`${source.seconds*source.clips.length} seconds`,imported_locations:locations,imported_brief:source.story_brief||source.details||'',palette:p.palette,avoid:p.avoid,sound_style:p.sound_style,source_story_number:source.storyNumber});
 story.scenes.forEach((s,i)=>{const c=source.clips[i];Object.assign(s,{script_line:c.narration,shots:c.shots,sound:c.sound||'None'});s.veo3_prompt=scene(story,i,{aspect,seconds:source.seconds});});
 return {W,p,cast,story,warnings:[...(source.warnings||[])]};
}
module.exports={applies,visual,scene,agent,prepare};
