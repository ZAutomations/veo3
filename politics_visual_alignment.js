'use strict';
const OBJECTS=[
 {re:/\bgrocer(?:y|ies)\b/i,label:'GROCERIES',visual:'recognizable grocery basket containing bread, milk and vegetables; amber ring points at the basket'},
 {re:/\bfuel\b|\bgasoline\b|\bpetrol\b/i,label:'FUEL',visual:'recognizable fuel-pump icon or miniature beside the actual explained expense; no military imagery'},
 {re:/\bmedical bills?\b|\bhealthcare costs?\b/i,label:'MEDICAL BILLS',visual:'recognizable medical invoice icon with a small medical cross; no invented prices, patient identity or diagnosis'},
 {re:/\bother expenses\b|\bother costs\b|\bdaily costs\b/i,label:'HOUSEHOLD COSTS',visual:'household receipt and wallet symbols; show a general budget burden without inventing specific purchases or amounts'},
 {re:/\brent\b/i,label:'RENT',visual:'house-key and rental-document icon, without an invented price'},
 {re:/\butility bills?\b|\belectricity bills?\b/i,label:'UTILITIES',visual:'small electricity-bill icon and lightning symbol; not an explosion or military strike'},
 {re:/\bchecks[\s-]+and[\s-]+balances\b/i,label:'CHECKS AND BALANCES',visual:'separate Congress and presidency institution boxes connected by opposing oversight arrows; no claim of unlimited authority'},
 {re:/\bcertified vote totals\b|\bcertified results\b/i,label:'CERTIFICATION',visual:'neutral results-document symbol with a certification/check marker, illustrating a process rather than an invented result'}
];
function cues(s,seconds){
 const speech=String(s.script_line||s.narration||''),total=(speech.match(/\S+/g)||[]).length;
 return OBJECTS.flatMap(rule=>{
  const match=rule.re.exec(speech);if(!match)return [];
  const before=(speech.slice(0,match.index).match(/\S+/g)||[]).length;
  const at=+(Math.min(seconds-.5,before/Math.max(total,1)*(seconds-.3))).toFixed(1);
  return [{phrase:match[0],at,label:rule.label,visual:rule.visual}];
 }).sort((a,b)=>a.at-b.at);
}
function validate(source){
 const issues=[];
 for(const c of source.clips){
  const visuals=c.shots.map(s=>s.visual).join(' ')+' '+(c.effect||'');
  for(const cue of cues(c,source.seconds)){
   const rule=OBJECTS.find(r=>r.label===cue.label);
   if(!rule.re.test(visuals)&&!visuals.toUpperCase().includes(cue.label))issues.push(`Clip ${c.number}: narration mentions ${JSON.stringify(cue.phrase)} but Shots/Effect do not depict it. Add a specific visible subject/icon and its narration-linked popup SFX.`);
  }
  if(/ivory timeline highlights the sourced event and unresolved issue|ivory diagram separates decision-makers and powers|topic-appropriate location\s*\(|source-supported transit or jurisdiction path/i.test(visuals))issues.push(`Clip ${c.number}: generic reusable shot boilerplate detected. Name this narration's actual subject, action and graphic; do not reuse an office/map template for every topic.`);
 }
 if(issues.length)throw Error('World Politics visual alignment needs correction:\n'+issues.join('\n'));
}
function forScene(story,s,seconds){
 const required=cues(s,seconds);
 return ['CLIP CALLOUT AUDIT SOURCE: '+JSON.stringify(s.script_line||''),
  'PHRASE-TO-VISUAL AUTHORITY: Each timed beat must show the concrete subject, action and consequence being narrated at that moment. No empty office, generic document, decorative map pan or unrelated industrial footage. Geographic shots explain a real spatial relationship; voter and household subjects use anonymous faceless civilian reconstructions or meaningful object diagrams. Illustrative expressions of concern are not evidence of an individual’s private vote or motive.',
  ...required.map(c=>`REQUIRED CUE near ${c.at}s, synchronized to the spoken phrase ${JSON.stringify(c.phrase)} (word timing is an estimate; the spoken phrase is the timing authority): visibly pop in ${c.visual}. Exact short label ${JSON.stringify(c.label)}; small circular badge with soft popup SFX on entry. Hold through that phrase, then clear to make room for the next cue. Keep the main action visible.`),
  'ADDITIONAL ENTITY AUDIT: For other important spoken places, institutions and objects, explicitly show the exact relevant named object or anchored label in speech order with pop/click SFX. Real people use text beside institutions/documents, never automatic portraits. Every sourced number/date keeps its qualifiers and exact value, brief stable type-on plus typing ticks. No invented zero, price, proportion, graph, map distribution or event. Arrows/rings/halos point at the exact discussed subject, not arbitrary decoration. At most two legible overlays at once. No full-sentence subtitles.',
  'EXECUTION: Treat Effect: None or a generic ambience-only instruction as absence of supplied detail, not cancellation of these required speech-linked cues. Keep the supplied narration unchanged, one consistent narrator, and audible but restrained popup/typewriter SFX below speech. Do not add background music when No music is explicitly selected.'
 ].join('\n');
}
module.exports={cues,validate,forScene};
