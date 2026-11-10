function scene(story,index,{seconds=story.scene_seconds,aspect=story.aspect_ratio}={}){
 const s=story.scenes[index];
 const names=[...(s.characters||[]),story.place?.name].filter(Boolean);
 return [`AUDIO FIRST: Generate ONE ${seconds}-second background-only video for scene ${index+1}. Format ${aspect}.`,
 require('./cats_behavior_contract').forStory(story),
 require('./cats_behavior_contract').forScene(story,s),
 `STYLE: ${story.style||''}. PALETTE: ${story.palette||''}`,
 `REFERENCES: ${names.map(n=>'@'+n).join(', ')}. Match the actual references' rendering, colors, character identity and materials.`,
 `CAST: ${JSON.stringify(story.character_descriptions||{})}`,
 require('./zack_badge_contract').forScene(story,s),
 `VISUAL PLAN: ${s.narrative_context||''}`,
 ...(s.shots||[]).map((shot,i)=>`SHOT ${i+1}: ${shot.start_seconds}-${shot.end_seconds}s: ${shot.visual}`),
 `EXTERNAL NARRATION CONTEXT — NEVER SPEAK OR DISPLAY THIS TEXT: ${s.external_narration||''}`,
 `Narration audio lasts ${s.audio_first_duration}s and is added later. Show each supplied action during its timed shot, without inventing events.`,
 'NATIVE AUDIO: ONLY natural environmental ambience and action-matched SFX. NO narration, dialogue, speech, whispering, singing, vocals or music. All visible characters remain non-speaking; animals may move their mouths only for the supplied natural behavior, never lip-sync narration. Do not read any prompt text aloud. No captions or subtitles. Preserve quiet space for a separately mixed narration track.',
 'No additional clips. Keep the end composition readable. Preserve the selected visual style throughout.'
 ].join('\n\n');
}
function agent(story,{from=1,to=story.scenes.length,...opts}={}){
 return `Create exactly ${to-from+1} separate background-only clips. No voice assets or spoken audio.\n\n`+
 story.scenes.slice(from-1,to).map((s,i)=>`Scene ${from+i}\n${scene(story,from+i-1,opts)}`).join('\n\n');
}
module.exports={scene,agent};
