'use strict';
const applies=s=>s?.geography_ready_import===true;
function containsTerm(text, term){
 const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const demonym=term==='Indonesia'?'Indonesian':term==='Malaysia'?'Malaysian':term==='France'?'French':term==='Spain'?'Spanish':term==='Poland'?'Polish':term==='Belarus'?'Belarusian':'';
 return new RegExp(`\\b(?:${escaped}${demonym?`|${demonym}`:''})\\b`,'i').test(text);
}
function spokenTime(text,term,seconds){
 const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const demonym=term==='Indonesia'?'Indonesian':term==='Malaysia'?'Malaysian':term==='France'?'French':term==='Spain'?'Spanish':term==='Poland'?'Polish':term==='Belarus'?'Belarusian':'';
 const match=new RegExp(`\\b(?:${escaped}${demonym?`|${demonym}`:''})\\b`,'i').exec(text);
 if(!match)return null;
 const before=(text.slice(0,match.index).match(/\b[\p{L}\p{N}]+\b/gu)||[]).length;
 const words=(text.match(/\b[\p{L}\p{N}]+\b/gu)||[]).length;
 return words?Math.max(0,Math.min(seconds-0.2,(before/words)*(seconds-0.2))):0;
}
function locationCallouts(story,s){
 const narration=String(s.script_line||'');
 const locations=story.imported_locations||[];
 const out=[];
 for(const loc of locations){
  const name=String(loc.name||'').trim();
  const parens=[...name.matchAll(/\(([^)]+)\)/g)].map(m=>m[1].trim());
  const base=name.replace(/\s*\([^)]*\)/g,'').trim();
  const baseParts=base.split(/\s+(?:and|&|\/)\s+/i).map(x=>x.trim()).filter(Boolean);
  const aliases=[...new Set([...baseParts,...parens])];
  const spoken=aliases.filter(a=>containsTerm(narration,a));
  if(!spoken.length)continue;
  const label=spoken.length>1&&baseParts.length&&parens.length?`${baseParts[0]}, ${parens[0]}`:spoken[0];
  const visibleName=label.toUpperCase();
  const anchor=baseParts.find(a=>containsTerm(narration,a))||spoken[0];
  const time=spokenTime(narration,anchor,Number(story.scene_seconds)||10);
  const timedShot=time===null?-1:s.shots.findIndex(shot=>time>=Number(shot.start_seconds)&&time<Number(shot.end_seconds));
  const textShot=s.shots.findIndex(shot=>aliases.some(a=>containsTerm(shot.visual,a)));
  const mapShot=Math.max(0,s.shots.findIndex(shot=>/map|coast|route|shore|strait|country|island/i.test(shot.visual)));
  const shotIndex=timedShot>=0?timedShot:textShot>=0?textShot:mapShot;
  if(!out.some(x=>x.label===visibleName))out.push({label:visibleName,where:loc.name,shotIndex,time:time??(Number(s.shots[shotIndex]?.start_seconds)||0)});
 }
 return out;
}
function visual(story,s){
 const labels=locationCallouts(story,s);
 return s.shots.map((shot,i)=>{
  const local=labels.filter(x=>x.shotIndex===i);
  const callout=local.length?` REQUIRED MAP LABELS: at ${local.map(x=>`${x.time.toFixed(1)}s pop exact, correctly spelled label “${x.label}” anchored to ${x.where}`).join('; at ')}. Put each label beside its correct landmass, flat and readable; point to that coast with a short glowing ring/leader and hold the label on screen. Do not substitute a route line, coastline highlight, or icon for these words.`:'';
  return `SHOT ${i+1} (${shot.start_seconds}-${shot.end_seconds}s): ${shot.visual}${callout}`;
 }).join('\n');
}
function calloutSound(story,s){
 const labels=locationCallouts(story,s);
 const cues=[];
 for(const item of labels){
  const shot=s.shots[item.shotIndex];
  if(shot)cues.push(`${item.time.toFixed(1)}s: one distinct, audible but restrained map-label pop/click as “${item.label}” appears`);
 }
 for(const shot of s.shots){
  const numeric=String(shot.visual).match(/\b\d[\d,]*(?:\s?(?:KM|MILES|M|KM\b|%))?/i);
  if(numeric)cues.push(`${Math.max(0,Number(shot.start_seconds)+0.2).toFixed(1)}s: short soft typewriter ticks only while “${numeric[0].trim().toUpperCase()}” types on`);
  if(/\b(?:animal|sheep|cattle|horse|elephant|whale|bird|wolf|dog|cat|ship|tanker|missile|tank|aircraft|jet|train|car|object)\b/i.test(shot.visual))
   cues.push(`${Math.max(0,Number(shot.start_seconds)+0.2).toFixed(1)}s: a restrained pop/click when the named icon/model appears`);
 }
 return cues.length?cues.join('; '):'No extra callout SFX unless a visible named callout appears.';
}
function scene(story,index,{aspect=story.aspect_ratio,seconds=8}={}){
 const s=story.scenes[index];
 return [`Generate ONE ${seconds}-second standalone Map Animation clip for scene ${index+1}. The timed shots are internal views, not extra clips.`,
  `TOPIC: ${story.title}. ${story.imported_brief||''}`,
  `STYLE: ${require('./geography_map_theme').style}. PALETTE: ${require('./geography_map_theme').palette}. Aspect: ${aspect}.`,
  'BASE MAP THEME AUTHORITY: Use the natural atlas base-map palette above even if an older script or reference requests vivid multicolour, neon or cinematic terrain. Keep all supplied objects, models, battles, animations, geographic facts, routes, badges and SFX; only the base map colour treatment changes. Routes and overlays retain purposeful contrasting colours. No geography distortion, invented locations or unsupported political status.',
  `LOCATION CATALOG: ${JSON.stringify(story.imported_locations||[])}. Use each location only when named or required by this scene; no single reference location is a fixed backdrop.`,
  'VISUAL AUTHORITY: Follow supplied shot subjects, actions and order exactly. For travel, retain one continuous route and cumulative progress. For wars, animate only source-supported military markers and movements. For geographic features, trace the feature accurately. Within this single clip, pan/track across the map at every timed shot change; even a real time/place change uses an in-camera map sweep/whip-pan, never a hard edit cut.',
  require('./within_clip_camera_contract').DIRECTION,
  require('./clip_join_camera_contract').DIRECTION,
  require('./narration_callout_contract').forScene(story,s,seconds),
  require('./geography_visual_contract').DIRECTION,
  require('./geography_overlay_contract').plan(s,seconds),
  'NARRATION-TO-VISUAL OBJECT LOCK: Every important concrete noun in the exact narration must appear as a recognizable, topic-appropriate map object, icon, badge, vehicle or evidence marker; every important verb must receive a visible animation. A route or firing line shows direction only and must never replace a named physical object. If the narration says missiles are fired, visibly show the missiles themselves as distinct small recognizable silhouettes. If the launch point is known, animate them leaving it with a brief restrained ignition flash and exhaust, then moving along the stated direction. If it is not named, show them already in flight entering from the frame edge toward the named area; do not invent a base or launcher. The trajectory line is supplementary. If it says multiple missiles, show multiple separate missiles with readable spacing, not one line. Show a brief non-graphic fire/impact flare at the named destination only when a strike or impact is explicitly stated. Do not invent launchers, targets, hit counts, damage, casualties or destruction. Apply the same rule to named tanks, aircraft, ships and other objects: render and animate the named object, not just an arrow or line. Badges/icons must point to the exact narration-relevant area, appear at that beat, and clear afterward; use no generic decorative icons. Keep combat effects non-graphic and subordinate to geographic clarity.',
  'EXACT NUMBER AND DATE CALLOUTS: For every year, date, count, distance, percentage, age, or other numeric fact spoken in this clip, show a clean animated on-screen callout at the corresponding narration beat. Copy the value exactly from the narration; convert spoken number words to standard digits (for example, “four” → “4”, “five thousand” → “5,000”) and preserve years such as “1954” exactly. Give the numerals a brief stable type-on reveal with soft synchronized typewriter ticks, then hold them fully readable; use a small ring or arrow to point at the relevant map feature. Keep any unit correctly spelled and exact. No extra figures, misspellings, malformed glyphs, digit swaps, flicker, perspective warping, or decorative text. If a longer phrase may render inaccurately, show the exact digits and a short exact unit/name. Do not add a number when narration contains none.',
  require('./narration_pace').lock(seconds),
  visual(story,s),
  `NARRATION: One consistent off-screen narrator (${story.narrator_voice||'clear energetic documentary voice'}). Read exactly: ${JSON.stringify(s.script_line)}. No character dialogue.`,
  `SOUND: ${s.sound||'None'}. REQUIRED BADGE POPUP SFX: ${require('./geography_overlay_contract').cues(s,seconds).map(c=>`${c.time.toFixed(1)}s (align to "${c.phrase}"): distinct audible entry popup with perfectly round ${c.icon} medallion, spring bounce + multicolour neon rim; on its exit, audible short swoosh with ring contraction and shrink-out`).join('; ')||'Pair every round icon/badge/sign spring-bounce entrance with a distinct audible popup and every contracting shrink-out exit with a short audible swoosh.'} CALLOUT SFX CUES, distinct from the BGM: ${calloutSound(story,s)}. Make these short effects audible under, never over, narration; keep the supplied BGM identity and level.`,
  `AVOID: ${story.avoid}. No invented events, labels, landmarks, equipment or captions; all on-screen callouts must be exact spoken names/numbers and source-supported.`].join('\n\n')+'\n';
}
function agent(story,{from=1,to=story.scenes.length,...options}={}){
 if(!applies(story))return null;
 const seconds=options.seconds||story.scene_seconds||8;
 return [`Create exactly ${to-from+1} separate ${seconds}-second clips for scenes ${from}-${to}; preserve supplied narration and chronology.`,...story.scenes.slice(from-1,to).map((s,i)=>`Scene ${from+i}\n${scene(story,from+i-1,{...options,seconds})}`)].join('\n\n');
}
function prepare(W,p,source,aspect){
 require('./geography_visual_contract').validate(source);
 if(![4,6,8,10].includes(source.seconds))throw Error('Map Animation supports 4, 6, 8 or 10 seconds per clip.');
 const locations=source.locations.length?source.locations:[{name:'Map locations',description:source.setting||source.story_brief||source.title}];
 const cast=[];
 const place={name:locations[0].name,description:locations[0].description,prompt:`${p.style} ${p.palette}. Natural atlas-style dimensional 2.5D map/location reference plate for ${locations[0].name}: ${locations[0].description}. Use natural green/brown terrain, ordinary blue water, grey rock, white snow and subtle hillshade; no neon landscape or rainbow region fills. Accurate geography; no text, invented borders or events.`};
 const story=W.buildStory(p,cast,{description:source.story_brief||source.details||source.title,moral:'',place_name:place.name,place_description:place.description,place_prompt:place.prompt},source.clips.map(c=>({scene_title:c.title,script_line:c.narration,narrative_context:visual({imported_locations:locations,scene_seconds:source.seconds},{script_line:c.narration,shots:c.shots}),characters:[]})));
 Object.assign(story,{geography_ready_import:true,script_import:true,narrated:true,scene_seconds:source.seconds,total_scenes:source.clips.length,duration:`${source.seconds*source.clips.length} seconds`,imported_locations:locations,imported_brief:source.story_brief||source.details||'',palette:p.palette,avoid:p.avoid,sound_style:p.sound_style,source_story_number:source.storyNumber});
 story.scenes.forEach((s,i)=>{const c=source.clips[i];Object.assign(s,{script_line:c.narration,shots:c.shots,sound:c.sound||'None'});s.veo3_prompt=scene(story,i,{aspect,seconds:source.seconds});});
 return {W,p,cast,story,warnings:[...(source.warnings||[])]};
}
module.exports={applies,visual,scene,agent,prepare};
