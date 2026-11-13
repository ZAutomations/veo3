const fs=require('fs'),path=require('path');
function sheet(p,character){
 const description=String(character.description||'').trim();
 if(!description)throw Error(`RECOVERY_REVIEW_REQUIRED: Character ${character.name} has no saved visual description; no reference invented.`);
 return `${p.whisk||p.style||'Match the saved story visual medium'}. CHARACTER IDENTITY REFERENCE: ${character.name}. ${description} One original character only, clear face, hair, wardrobe and distinguishing details; neutral studio background and readable even light. Reference-sheet composition overrides video letterboxing and scene camera directions. No scene, other people, words, labels, captions, logos or watermark. Preserve this exact identity and clothing across the story.`;
}
function fill(story,ref){
 if(String(ref.prompt||'').trim()||/place|set|location|room/i.test(String(ref.kind||'')))return ref;
 const description=Object.entries(story?.character_descriptions||{}).find(([name])=>name.toLowerCase()===String(ref.name).toLowerCase())?.[1];
 if(!description){
  if(ref.localFile)return ref;
  throw Error(`RECOVERY_REVIEW_REQUIRED: Required character reference ${ref.name} has an empty prompt and no saved description. Nothing generated or silently skipped.`);
 }
 return {...ref,prompt:sheet(story.imported_preset||story,{name:ref.name,description})};
}
function needsRepair(storyFile){
 const file=path.join(path.dirname(storyFile),'refs.json');
 if(!fs.existsSync(file))return false;
 const raw=JSON.parse(fs.readFileSync(file,'utf8')),refs=Array.isArray(raw)?raw:raw.refs||[];
 return refs.some(r=>r?.name&&!/place|set|location|room/i.test(String(r.kind||''))&&!r.localFile&&!String(r.prompt||'').trim());
}
module.exports={sheet,fill,needsRepair};
