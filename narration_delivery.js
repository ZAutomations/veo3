const fs=require('fs'),path=require('path');
function direction(story){
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'narration_tones.json'),'utf8'));
 const key=String(story.preset_id||story.preset||'').replace(/_/g,'-');
 let base=data.profiles[key];
 if(!base){
  if(/relationship|babyandghost|quiet-power/.test(key))base='Emotionally present, intimate and conversational; subtle tension, sincere reactions and restrained warmth. Preserve each established speaker identity and dialogue pacing.';
  else if(/space|science|technology/.test(key))base='Wonder-filled, clear science storyteller with lively curiosity, confident explanations and restrained awe.';
  else if(/wolf|crime|dark|horror|mafia/.test(key))base='Controlled suspense and quiet intrigue, crisp factual emphasis and restrained dramatic reveals; never rush or shout.';
  else base=data.profiles.default;
 }
 const beats=(story.scenes||[]).map((s,i)=>{const text=String(s.script_line||'').toLowerCase();const situation=(data.situation_rules||[]).find(r=>r.words.some(w=>new RegExp('\\b'+w+'\\b').test(text)));return `Beat ${i+1}: ${s.narration_tone||s.voiceover_tone||s.emotional_tone||s.emotion||situation?.tone||(i===0?'curious compelling hook':i===story.scenes.length-1?'clear satisfying conclusion':'clear engaged explanation')}.`;});
 return `PRESET DELIVERY (${key||'custom'}): ${base} ${String(story.narrator_tone||story.narrator_voice||'').slice(0,900)} Keep the selected voice identity, pitch range, accent and baseline speaking pace consistent throughout. Express emotion through emphasis and intonation, not abrupt speed changes. Never start slowly and rush the ending. Dates and numbers remain clear. ${beats.join(' ')}`;
}
module.exports={direction};
