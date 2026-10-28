const assert=require('assert'),fs=require('fs');
const master=fs.readFileSync('Master prompts/3d-zack-style.txt','utf8');
for(const text of ['ZETOMATE V6','30 original suggested titles','What If','What Happens When','How Does It Work','Why Does','AUTO SELECT 10','ALL_STORIES_READY_IMPORT.txt','Video_Script_8x8.txt','Thumbnail_9x16.png','Thumbnail_Prompts.txt','YouTube_SEO.txt','Production_Notes.txt','FOUR complete independent Ideogram-ready','Not generated — prompts provided','Production profile: zetomate-8x8','EXACTLY EIGHT VIDEO CLIPS','EXACTLY THREE','Keep SEO, thumbnail instructions','not a request for a two-panel collage'])assert(master.includes(text),text);
assert(!master.includes('default to one;'));
const json=JSON.parse(fs.readFileSync('styles.json','utf8'));
const presets=Array.isArray(json)?json:Object.values(json).filter(Array.isArray).flat();
assert(presets.find(p=>p.id==='3d-zack-style').direction.includes('CONTENT SCOPE:'));
console.log('PASS: V6 fresh-session suggestions, 8x8 contract, ten-story package, four thumbnail variants, SEO, separate import files and honest image/ZIP delivery.');
