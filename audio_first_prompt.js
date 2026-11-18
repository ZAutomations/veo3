function scene(story,index,{seconds=story.scene_seconds,aspect=story.aspect_ratio}={}){
 const s=story.scenes[index];
 const names=[...(s.characters||[]),story.place?.name].filter(Boolean);
 return [`AUDIO FIRST: Generate ONE ${seconds}-second background-only video for scene ${index+1}. Format ${aspect}.`,
 require('./cats_behavior_contract').forStory(story),
 require('./cats_behavior_contract').forScene(story,s),
 `STYLE: ${story.style||''}. PALETTE: ${story.palette||''}`,
 `REFERENCES: ${names.map(n=>'@'+n).join(', ')}. Match the actual references' rendering, colors, character identity and materials.`,
 `CAST: ${JSON.stringify(story.character_descriptions||{})}`,
 require('./external_visual_contract').forScene(story,s,seconds),
 require('./zack_badge_contract').forScene(story,s),
 require('./fast_camera_rhythm').detailBeat(story),
 `VISUAL PLAN: ${s.narrative_context||''}`,
 ...(s.shots||[]).map((shot,i)=>`SHOT ${i+1}: ${shot.start_seconds}-${shot.end_seconds}s: ${shot.visual}`),
 'Show each supplied action during its timed shot. Use the visual plan and its timed actions as the complete scene brief.',
 require('./geography_scene_direction').forScene(story,s,seconds),
 ...(story.full_voiceover_first?['Keep the full visual runtime active with relevant movement. Finish the supplied action without an extra pause, frozen frame, title card or ending.']:[]),
 'AUDIO REQUIREMENT FOR THIS VIDEO: Only non-vocal environmental ambience and action-matched sound effects such as contact, movement, room tone or marker strokes. NO narration, dialogue, speech, whispering, human singing or music. Keep on-screen people silent with no lip-sync. Natural nonverbal animal sounds are permitted only when explicitly supplied. If non-vocal audio is unavailable, leave the clip silent. Any lettering specified in the shots is a visual graphic only. No spoken or captioned reading of lettering or prompt text.',
 'No additional clips. Keep the end composition readable. Preserve the selected visual style throughout.'
 ].filter(Boolean).join('\n\n');
}
function agent(story,{from=1,to=story.scenes.length,...opts}={}){
 return `Create exactly ${to-from+1} separate background-only clips. No voice assets or spoken audio.\n\n`+
 story.scenes.slice(from-1,to).map((s,i)=>`Scene ${from+i}\n${scene(story,from+i-1,opts)}`).join('\n\n');
}
module.exports={scene,agent};
