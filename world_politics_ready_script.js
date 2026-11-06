'use strict';
const ID='world-politics-map-explain';
const applies=story=>story?.politics_ready_import===true;
const MEDIUM={MAP:'Accurate recognizable satellite-relief geography; anchored country labels, source-supported borders, routes and moving physical asset icons. Never replace a named missile, aircraft or ship with a line alone.',RECONSTRUCTION:'Cinematic faceless matte 3D adult mannequins, blank heads and role-appropriate wardrobe in the actual narrated place. Clearly illustrative reconstruction, never archival footage or evidence of a private meeting.',EXPLAINER:'Clean editorial whiteboard motion graphics: ink strokes, flat vector diagrams, timelines, document highlights and comparison bars on warm off-white. Use only sourced figures; no invented document text or quotation.'};
function validate(source){
 let map=0,total=0;
 for(const clip of source.clips)for(const shot of clip.shots){
  const mode=shot.visual.match(/^\[(MAP|RECONSTRUCTION|EXPLAINER)\]\s*/)?.[1];
  if(!mode)throw Error(`Clip ${clip.number}: start every Shot description with [MAP], [RECONSTRUCTION] or [EXPLAINER]. Keep the existing Shot N: time range syntax.`);
  const duration=shot.end_seconds-shot.start_seconds;total+=duration;if(mode==='MAP')map+=duration;
 }
 if(Math.abs(map-total/2)>0.5)throw Error(`World Politics requires 50% map screen time (±0.5s); received ${map}s map in ${total}s. Adjust timed shot markers; do not add new fields.`);
 if(!String(source.sources||'').trim())throw Error('World Politics needs Sources: with research cutoff, supporting source URLs and claim attribution. Research must happen before import.');
}
function scene(story,index,{seconds=story.scene_seconds||8,aspect=story.aspect_ratio}={}){
 const s=story.scenes[index];
 return [`Generate ONE ${seconds}-second clip for scene ${index+1}, aspect ${aspect}. Internal shots are timed camera beats, not separate clips.`,
 'FACTUAL BASIS: Preserve the source-supported facts, uncertainty, attribution and event dates in this clip. No invented breaking news or story-wide unrelated people.',
 'HYBRID VISUAL IDENTITY: Honor each shot marker independently. Maps use accurate satellite relief; reconstruction uses faceless 3D mannequins; explainer uses editorial ink/vector diagrams on off-white. Do not turn every shot into a map, technical dashboard or mannequin room. Keep shared teal, amber and ivory accents. Sources determine content; the marker determines its visual medium.',
 'REFERENCES: Attach only designs matching this clip’s actual subjects and locations. Never force an unrelated story-wide location catalog into this scene.',
 ...s.shots.map((shot,i)=>{const mode=shot.visual.match(/^\[(MAP|RECONSTRUCTION|EXPLAINER)\]/)?.[1];return `SHOT ${i+1} (${shot.start_seconds}-${shot.end_seconds}s): ${MEDIUM[mode]||''} ${shot.visual}`;}),
 require('./within_clip_camera_contract').DIRECTION,require('./clip_join_camera_contract').DIRECTION,
 'For a medium change, track a map pin or document edge into a visible foreground occlusion, then reveal the next medium and settle. Keep relevant labels readable; no arbitrary hard internal cuts or unrelated globe spins.',
 require('./narration_callout_contract').forScene(story,s,seconds),
 `EFFECT: ${s.effect||'Use restrained narration-linked place/entity labels and sourced numeric callouts.'}`,
 require('./narration_pace').lock(seconds),
 `NATIVE AUDIO: One consistent off-screen ${story.narrator_voice}; established Flow voice ${story.flow_voice||'Alnilam'}. Read verbatim: ${JSON.stringify(s.script_line)}. All pictured figures silent. SOUND: ${s.sound||'Restrained factual documentary instrumental pulse and scene ambience'}. Pair place/person/object callouts with audible restrained pop/click, dates and numbers with synchronized typewriter ticks. Narration foreground; no lyrics. Honor explicit No music.`,
 'FACTUAL INTEGRITY: Clearly distinguish verified fact, attributed allegation and analysis. No fabricated quote, statistic, electoral result, territorial control or motive. Show disputed borders/claims as disputed and source-dated. Named people may be identified in factual narration, but identify them with exact name labels beside relevant institutions or maps, with no automatic human representation, never invented likenesses or cloned voices. Non-graphic combat illustration only. No party persuasion, misleading propaganda or invented archival footage.'
 ].join('\n\n')+'\n';
}
function prepare(W,p,source,aspect){
 validate(source);
 const result=require('./fern_ready_script').prepare(W,p,source,aspect),story=result.story;
 const originalPlaceName=story.place.name;
 story.place={...story.place,name:'Map Reference',description:`Geographic/context coverage: ${originalPlaceName}. ${story.place.description||''}`};
 delete story.fern_ready_import;
 Object.assign(story,{politics_ready_import:true,visual_mix:{map:0.5,reconstruction:0.25,explainer:0.25},flow_voice:p.flow_voice});
 story.scenes.forEach((s,i)=>{s.veo3_prompt=scene(story,i,{seconds:source.seconds,aspect});});
 return result;
}
function agent(story,{from=1,to=story.scenes.length,...options}={}){
 if(!applies(story))return null;
 return [`Create exactly ${to-from+1} separate clips for scenes ${from}-${to}. Preserve scene IDs, supplied facts, narration, duration and per-shot medium markers.`,...story.scenes.slice(from-1,to).map((s,i)=>`Scene ${from+i}\n${scene(story,from+i-1,options)}`)].join('\n\n');
}
module.exports={ID,applies,validate,scene,prepare,agent};
