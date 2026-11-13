function headline(story){
 const title=String(story.title||'').replace(/\s+/g,' ').trim();
 let text=String(story.thumbnail?.headline||title).replace(/\s+/g,' ').trim();
 if(title.toLowerCase().startsWith(text.toLowerCase())&&text.length<title.length)text=title;
 return text||'Quiet Power';
}
function lines(text){
 const words=text.split(/\s+/).filter(Boolean),count=Math.min(4,Math.max(1,Math.ceil(words.length/3)));
 const result=[];let at=0;
 for(let i=0;i<count;i++){
  const take=Math.ceil((words.length-at)/(count-i));result.push(words.slice(at,at+take).join(' '));at+=take;
 }
 return result;
}
function prompt(story,aspect='9:16'){
 const text=headline(story),layout=lines(text).map((line,i)=>`Line ${i+1}: ${JSON.stringify(line)} — ${i%2?'black brush-script lettering on a vivid yellow rough paint stroke':'white brush-script lettering on a vivid red rough paint stroke'}.`).join('\n');
 const cast=Object.entries(story.character_descriptions||{}).map(([name,description])=>`${name}: ${description}`).join('\n');
 const conversation=(story.scenes||[]).flatMap(s=>(s.dialogue||[]).map(t=>`${t.speaker}: ${t.line}`)).join(' ').slice(0,2000);
 return `Create ONE finished ${aspect} thumbnail/end-card image for the original fictional cinematic conversation ${JSON.stringify(story.title)}. Native full-frame ${aspect} composition filled edge to edge; no black bars, letterbox, inset landscape frame, collage or split panels. This is a still promotional image, not a reference sheet or an extra video scene.

VISUAL DESIGN: Match a polished photorealistic moody conversation poster. Large expressive faces of the actual two adult story characters occupy the upper/middle 55–65% of the image, turned toward one another across the actual story setting. Natural skin and hair, rich charcoal wardrobe, warm amber lamp/candle highlights, cool background accents, cinematic shallow depth and soft night/dusk bokeh. Keep eyes and facial expressions unobscured and readable at phone size. Show the specific conversational tension, not generic romance, hostility or an invented event. A friendship story uses its actual friend, never an automatic replacement woman. No toy/CGI/anime look or copied actor/influencer likeness.

EXACT STORY CAST — retain these identities and wardrobe, not the sample poster's people:
${cast}
ACTUAL LOCATION: ${story.place?.description||story.description||story.title}.
CONVERSATION CONTEXT (do not render these dialogue lines as captions): ${conversation}

TOP BRAND MARK: Small elegant uppercase serif text in the top center: first line exactly "QUIET" in clean white, second line exactly "POWER" in warm yellow/gold. Thin understated gold horizontal rules beside it and a short red paint underline. This text is the requested original series identity; no additional logos, watermark or UI.

LOWER HEADLINE: Overlay large, expressive but highly legible brush-script lettering across the lower 35–45%, with alternating red and yellow rough-edged horizontal paint swashes. The photo remains behind the swashes; do not create an empty lower panel. White text on red rows and black text on yellow rows. Keep faces clear. Render EVERY supplied word once, correctly spelled, in this exact row order:
${layout}
Complete headline: ${JSON.stringify(text)}. Never drop the ending, cut the title at an arbitrary word count, invent a claim, duplicate a word or add extra captions. Adjust type size/line spacing to fit the COMPLETE headline with safe margins. Keep punctuation natural and readable. For a landscape/square request reflow this same hierarchy to the native canvas rather than stretching or adding bars.

Use the existing story character images as identity guides when available. One coherent, original cinematic moment, truthful to the supplied fictional conversation. No unrelated props, extra people, body-shaming caricatures, nudity or misleading real-event claims. No other words beyond QUIET POWER and the exact headline.\n`;
}
module.exports={headline,lines,prompt};
