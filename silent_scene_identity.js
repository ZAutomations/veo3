const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const spoken=s=>s.dialogue?.some(d=>String(d.line||'').trim())||String(s.script_line||'').trim();
function isSilent(story){return story?.narrated===false&&story.scenes?.length>0&&story.scenes.every(s=>!spoken(s));}
function needles(scene){
 const spokenLines=scene.dialogue?.length?scene.dialogue.map(d=>d.line):[scene.script_line];
 const lines=spokenLines.filter(Boolean).map(norm);
 if(lines.length)return lines;
 // Match actual action instructions, never repeated style, cast or room text.
 const shots=[...new Set((scene.shots||[]).map(s=>norm(s.visual)).filter(s=>s.length>=30))];
 if(shots.length>=2&&shots.join('').length>=100)return shots;
 const action=norm(scene.narrative_context);
 return action.length>=100?[action]:[];
}
function matches(text,scene){const source=norm(text),parts=needles(scene);return parts.length>0&&parts.every(n=>source.includes(n));}
module.exports={isSilent,needles,matches};
