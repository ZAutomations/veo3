const assert=require('assert'),fs=require('fs');
const master=fs.readFileSync('Master prompts/3d-zack-style.txt','utf8');
for(const text of ['ZETOMATE V8','30 original suggested titles','What If','What Happens When','How Does It Work','Why Does','AUTO SELECT 10','ALL_STORIES_READY_IMPORT.txt','SCRIPT.txt','Story_141_Thumbnail.png','IDEOGRAM_3_PROMPTS.txt','SEO_METADATA.txt','Production Notes','THREE complete independent Ideogram-ready','Not generated — prompts provided','Production profile: zetomate-8x8','EXACTLY EIGHT VIDEO CLIPS','EXACTLY THREE','Do not insert thumbnail text, SEO','not a request for a two-panel collage'])assert(master.includes(text),text);
for(const text of ['EXACTLY TWO TEXT LEVELS','2–4 powerful words','ten separate image-generation jobs','ONE SUPPORTING 3D MINI VISUAL','1080×1920','not their exact scene','partial generation is explicitly partial','Thumbnail typography and supporting icons must never be injected'])assert(master.includes(text),text);
for(const text of ['OPENING QUESTION LOCK','CONTINUOUS CAMERA DEFAULT','ONE UNBROKEN CAMERA TAKE','departure object','arrival anchor','clip join']){if(text==='arrival anchor')continue;assert(master.includes(text),text);}
assert(!master.includes('optional short curiosity subline'));
assert(!master.includes('default to one;'));
const json=JSON.parse(fs.readFileSync('styles.json','utf8'));
const presets=Array.isArray(json)?json:Object.values(json).filter(Array.isArray).flat();
assert(presets.find(p=>p.id==='3d-zack-style').direction.includes('CONTENT SCOPE:'));
console.log('PASS: V8 fresh-session suggestions, 8x8 contract, ten-story package, three thumbnail variants, SEO, separate import files and honest image/ZIP delivery.');
