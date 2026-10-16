const ID='relationship-dialogue-dog-couple';
const LABEL='Relationship Dialogue — Dog Couple (Realistic Comedy)';
const applies=p=>p?.id===ID||p?.niche===LABEL||p?.character_species==='dog';
const PROFILES={
 sarah:'FICTIONAL ADULT DOG CHARACTER. Sarah is a mature female cream-coloured Labrador-mix dog, approximately four years old, with soft cream fur, dark brown eyes, black nose, floppy ears and a natural canine muzzle. Normal dog anatomy: four legs and paws, fur-covered body and one tail. She uses a clear adult female comedy voice. Preserve her coat colour, muzzle, ears, eyes, size and markings in every clip. No human face, hands, torso, hairstyle or clothes.',
 george:'FICTIONAL ADULT DOG CHARACTER. George is a mature male black Labrador-mix dog, approximately five years old, with glossy short black fur, dark brown eyes, black nose, floppy ears and a natural canine muzzle. Normal dog anatomy: four legs and paws, fur-covered body and one tail. He uses a warm adult male deadpan comedy voice. Preserve his coat colour, muzzle, ears, eyes, size and markings in every clip. No human face, hands, torso, hairstyle or clothes.'
};
const RULES='Two fictional mature pet dogs behave like a comedic couple and speak with adult voices. Keep natural canine bodies and readable muzzle animation on the speaking dog only; the listener keeps its mouth relaxed and reacts with eyes, ears, head tilts or a small paw movement. Human-like personality does not mean a human body. Build one domestic misunderstanding through a hook, playful teasing, callbacks and a clean punchline. Cheeky flirting is light and non-explicit: attention, snoring, blanket stealing, snacks, the TV remote, jealousy over treats, or sarcastic compliments. Keep all physical action ordinary and non-sexual. Do not depict or describe sexual activity, mating, erotic movement, exposed sexual anatomy, animal abuse, coercion or childlike voices. If a source joke depends on an explicit sexual meaning, replace it with a genuinely different clean domestic joke; do not hide the same act behind code words. No claims of guaranteed provider acceptance. No narrator, music, subtitles, captions or logos. Use one consistent comfortable room with two clearly distinguishable dogs and their reference identities. No human characters. Finish each complete line, pause 0.30 seconds, then the next dog speaks. Keep delivery dry, playful and audible, not an angry argument or a serious therapy lecture.';
function approvedCast(p,cast){
 if(!applies(p))return cast;
 if(!Array.isArray(cast)||cast.length!==2)throw Error('Dog couple requires exactly Sarah and George.');
 const result=cast.map(c=>{
  const original=String(c.name||'');
  const name=/^sarah$/i.test(original)?'Sarah':/^george$/i.test(original)?'George':String(c.gender||'').toLowerCase()==='female'?'Sarah':String(c.gender||'').toLowerCase()==='male'?'George':null;
  if(!name)throw Error('Dog couple needs Sarah/George names or explicit female/male labels.');
  const description=PROFILES[name.toLowerCase()];
  return {...c,name,source_names:[...new Set([original,...(c.source_names||[])])],type:'animal',gender:name==='Sarah'?'female':'male',description,sheet_prompt:`Photorealistic pet-dog identity reference sheet. ${description} Front, three-quarter, side and full-body views of the same mature dog, standing naturally on four paws on a plain light background. No humans, text, watermark or clothing.`};
 });
 if(new Set(result.map(c=>c.name)).size!==2)throw Error('Dog couple needs one female Sarah and one male George.');
 return result;
}
function common(p,c){return `TITLE: ${c.title}\nCREATOR DETAILS: ${c.detail}\nSOURCE: ${JSON.stringify(c.source||{})}\nFORMAT: ${c.count} clips of ${c.seconds} seconds, aspect ${c.aspect||'9:16'}.\nLOOK: ${p.style}\n${RULES}\nFixed cast: ${JSON.stringify(PROFILES)}. Gender-labelled safe source dialogue may be adapted in its original order; these references define the dog appearances. For an original idea, write 2-3 turns and roughly 14-22 spoken words per eight-second clip, with natural reaction beats. Do not stretch a short joke with repetitive filler: build a connected setup, reversals and callbacks. The final line is the strongest punchline; an optional brief audience question can be in-character if requested.`;}
function cast(p,c){return `${common(p,c)}\nReturn ONLY JSON {"description":"","moral":"","target_audience":"","thumbnail":{"headline":"","visual_concept":""},"place_name":"","place_description":"","place_prompt":"","blocking":"","characters":[{"name":"Sarah","gender":"female","type":"animal","description":"","sheet_prompt":""},{"name":"George","gender":"male","type":"animal","description":"","sheet_prompt":""}],"outline":[{"scene_title":"","beat":"","visual":""}]}. Exactly ${c.count} outline entries. Place reference is the empty room, without dogs or humans. Use a sofa, pet cushions or an ordinary covered bed; the room and posture must be visibly non-sexual. No other cast.`;}
function scenes(p,c){return `${common(p,c)}\nCAST: ${JSON.stringify(c.cast)}\nROOM: ${c.place}\nBLOCKING: ${c.blocking||'Two separate comfortable dog resting spots in the same room.'}\nPREVIOUS: ${JSON.stringify(c.previous||[])}\nWrite only clips ${c.from+1}-${c.to}. OUTLINE: ${JSON.stringify(c.outline.slice(c.from,c.to))}. Keep the simple speaker-labelled workflow. Every visual describes dog actions, not human gestures. Return ONLY {"scenes":[{"scene_title":"","dialogue":[{"speaker":"Sarah","line":""},{"speaker":"George","line":""}],"narrative_context":"","characters":["Sarah","George"]}]}, exactly ${c.to-c.from} scenes. Preserve safe supplied dialogue in order; replace explicit material with a different clean joke before writing. No narrator.`;}
function render(story,scene){
 const turns=scene.dialogue||[];
 if(!turns.length||turns.some(t=>!['Sarah','George'].includes(t.speaker)||!String(t.line||'').trim()))throw Error('Dog comedy needs labelled Sarah/George turns.');
 return [`Generate one ${story.scene_seconds||8}-second clip. Keep the aspect ratio selected in Flow.`,
  `STYLE: ${story.style}. Match the dog reference images.`,
  `SETTING: ${story.place?.name||'Livingroom'}. ${scene.narrative_context||'The two dogs rest on separate comfortable spots and exchange a playful remark.'} Simple steady two-dog framing; an optional speaker close-up or reaction cut, no complex camera movement.`,
  `CHARACTERS: ${PROFILES.sarah} ${PROFILES.george}`,
  'AUDIO: Playful dry conversation at clear normal volume. Only the labelled dog speaks each complete line; the other listens. Natural dog muzzle movement, no human lips. Finish each line, then leave a 0.30-second pause. No overlapping voices or narrator. Ordinary non-sexual pet behaviour, no music, captions or subtitles.',
  ...turns.map(t=>`${t.speaker} (${t.speaker==='Sarah'?'female':'male'} adult voice): ${JSON.stringify(t.line)}`)].join('\n')+'\n';
}
function isDogRefs(refs){return (refs||[]).some(r=>String(r.prompt||'').includes('FICTIONAL ADULT DOG CHARACTER'));}
function savedForStory(file,mode,settings){
 const fs=require('fs'),path=require('path');
 if(file&&fs.existsSync(file)){
  let target=file;
  if(fs.statSync(file).isDirectory())target=path.join(file,fs.readdirSync(file).find(n=>/_story\.json$/i.test(n))||'');
  if(fs.statSync(target).isFile()){
   const story=JSON.parse(fs.readFileSync(target,'utf8').replace(/^\uFEFF/,''));
   if(applies(story)||story.zack_ready_import)return null;
  }
 }
 return require('./saved_couple').loadSavedCouple(mode,settings);
}
module.exports={ID,LABEL,PROFILES,RULES,applies,approvedCast,cast,scenes,render,isDogRefs,savedForStory};
