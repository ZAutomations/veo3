// Compact authoring contract for the approved simple relationship workflow.
// Uses positive scene requirements and the user's text, not every preset's
// unrelated exclusion/example paragraph. Provider safety checks remain intact.
function applies(p){return /^relationship-dialogue/.test(p.id||'')&&p.dialogue_prompt_format==='minimal-test';}
function sourceText(source){
 return (source?.clips||[]).map((c,i)=>`Source clip ${i+1}:\n`+(c.source_dialogue||[]).map(d=>`${d.speaker||'Unlabelled'} (${d.gender||d.speaker_gender||'unspecified'}): ${d.line}`).join('\n')).filter(s=>s.split('\n').length>1).join('\n\n');
}
function common(p,c){
 return `Prepare a calm, respectful conversation between two adults: Sarah, a woman aged 25, and SAM, a man aged 28.
TITLE: ${c.title}
CREATOR'S SCRIPT OR IDEA:
${c.detail||'Develop an original conversation from the title.'}
${sourceText(c.source)?'VERIFIED SOURCE CONVERSATION:\n'+sourceText(c.source):''}
FORMAT: ${c.count} clips, ${c.seconds} seconds each, ${c.aspect}.
VISUAL MEDIUM: ${p.style}
Use the provided script or verified source conversation in order. Preserve each labelled speaker and the full meaning. For a supplied Sarah/SAM transcript keep the spoken wording exactly, grouping consecutive turns into clips. For a video source keep its speaker mapping, sequence and supplied clip boundaries. If this is an idea without dialogue, develop a concise conversation that explores it naturally.
Adapt adult relationship conversations only. Preserve factual source ages; do not turn a source person younger than 18 into an adult character. If the source is unsuitable for an ordinary adult conversation, return an error for review instead of rewriting it to conceal the issue.
Both characters speak calmly at normal indoor volume. Complete each line, then pause 0.30 seconds before the next speaker. Keep the same reference appearances, outfits and bright, airy domestic location throughout. Each person has a separate comfortable seat or standing spot with a clear conversational gap. Describe natural small reactions. The characters speak on screen, with no narrator.`;
}
function cast(p,c){
 const approved=c.houseCast?.length?c.houseCast.map(x=>({name:x.name,description:x.description})):Object.entries(p.fixed_couple_appearance||{}).map(([name,description])=>({name:name==='sarah'?'Sarah':'SAM',description}));
 return `${common(p,c)}
APPROVED APPEARANCES: ${JSON.stringify(approved)}
Return a character and outline package as JSON. Include exactly Sarah and SAM. Their descriptions and image sheet prompts must preserve the approved appearances in the specified visual medium. Each sheet shows the same adult from several angles on a plain neutral background. Choose one bright domestic room, give it a short unique name, describe the empty room, and write an image prompt in the same visual medium. Keep the arrangement relaxed and consistent. Provide exactly ${c.count} consecutive outline beats covering the entire conversation without padding or changing its outcome.
Also provide a short description, moral, target audience, and a thumbnail with a headline of at most five words and a visual concept illustrating this topic.
Return ONLY JSON with this shape:
{"description":"","moral":"","target_audience":"","thumbnail":{"headline":"","visual_concept":""},"place_name":"","place_description":"","place_prompt":"","blocking":"","characters":[{"name":"Sarah","gender":"female","type":"human","source_name":"","description":"","sheet_prompt":""},{"name":"SAM","gender":"male","type":"human","source_name":"","description":"","sheet_prompt":""}],"outline":[{"title":"","beat":""}]}`;
}
function scenes(p,c){
 return `${common(p,c)}
CAST: ${JSON.stringify(c.cast)}
FIXED ROOM: ${c.place}
ARRANGEMENT: ${c.blocking||'Relaxed, comfortable conversational distance.'}
PRECEDING DIALOGUE: ${JSON.stringify(c.previous.slice(-2).map(s=>s.dialogue||[]))}
WRITE ONLY CLIPS ${c.from+1} THROUGH ${c.to}. Follow these beats in their given order:
${JSON.stringify(c.outline.slice(c.from,c.to))}
For every clip, provide scene_title, dialogue with Sarah/SAM speaker labels and line text, a short narrative_context describing natural reactions in this room, and characters ["Sarah","SAM"]. Dialogue must fit ${c.seconds} seconds at a calm pace. For original ideas use about ${Math.round(c.seconds*2.25)}-${Math.round(c.seconds*3)} spoken words; supplied transcript/source dialogue takes priority and must remain complete and in order. Include only the requested ${c.to-c.from} scenes. Leave rendering and camera instructions out of narrative_context: the visual medium and framing are already specified.
Return ONLY {"scenes":[{"scene_title":"","dialogue":[{"speaker":"Sarah","line":""},{"speaker":"SAM","line":""}],"narrative_context":"","characters":["Sarah","SAM"]}]}.`;
}
module.exports={applies,cast,scenes};
