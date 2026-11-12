const assert=require('assert'),fs=require('fs');
const I=require('../import_ready_script'),S=require('../single_scene_prompts'),A=require('../audio_first_prompt');
const p=JSON.parse(fs.readFileSync('styles.json','utf8')).styles.find(p=>p.id==='cats-behavior-3d');
const z=JSON.parse(fs.readFileSync('styles.json','utf8')).styles.find(p=>p.id==='3d-zack-style');
assert(p&&p.content_pillars.length===10&&p.style===z.style&&p.palette===z.palette);
const text=`Story 1
Title: Why Does Your Cat Slow-Blink?
Preset: cats-behavior-3d
Production profile: zetomate-flex
Clip seconds: 10
Estimated duration: 10 seconds
Characters:
Miso: Adult orange tabby domestic cat, amber eyes, white chin and front paws; natural feline proportions, no clothing.
Locations:
Living Room: Warm living room, green sofa and amber window light.
Continuity: Same coat pattern, eye color and furniture throughout.
Clip 1:
Narration: "Why does your cat slowly blink at you? This gesture can occur during relaxed interactions, but its meaning depends on the ears, posture, and situation around your cat."
Shot 1: 0–5 seconds — Track beside Miso resting on the green sofa; show relaxed ears, posture and a slow blink.
Shot 2: 5–10 seconds — Pan from Miso's eyes to the relaxed tail in the same room, preserving the natural feline body.
Effect: A round eye pictogram with animated neon rim, entry popup and exit swoosh beside the visible eyes.
Sound: Quiet room ambience, synchronized badge popup and swoosh; gentle original instrumental BGM below one off-screen narrator.`;
const parsed=I.parse(text)[0],prepared=I.prepare(parsed,'9:16'),story=prepared.story;
assert(story.preset_id==='cats-behavior-3d'&&story.zack_ready_import);
assert(prepared.cast[0].type==='cat');
assert(!prepared.cast[0].description.includes('Keep the same face, proportions, hair and fixed clothing'));
assert(story.scenes[0].characters.includes('miso'));
const prompt=S.promptForScene(story,0,{seconds:10});
for(const t of ['CATS BEHAVIOR EXPLAINER','ZACK ANIMATED ROUND PICTOGRAM BADGES','orbiting arc','popup/plop','swoosh','Natural non-speaking animals','FUNNY HOOK + VIEWER QUESTION','exactly one short topic-specific viewer question'])assert(prompt.includes(t),t);
assert(!prompt.includes('Silent on-screen cast, mouths closed'));
const audioStory={...story,audio_first:true,scenes:story.scenes.map(s=>({...s,script_line:'',external_narration:s.script_line,audio_first_duration:9.4}))};
const audio=A.scene(audioStory,0);assert(audio.includes('CATS BEHAVIOR EXPLAINER')&&audio.includes('ZACK ANIMATED ROUND')&&audio.includes('NO narration'));
assert.throws(()=>I.parse(text.replace('28','31').replace('situation around your cat.','situation around your cat every single day in every home.')));
const master=fs.readFileSync('Master prompts/cats-behavior-3d.txt','utf8');
for(const t of ['LOVE, TRUST & BONDING','BODY LANGUAGE, MOOD & BOUNDARIES','INSTINCTS, PLAY & FUNNY HABITS','SENSES, ANATOMY & HOW THE BODY WORKS','cats-behavior-3d','28–30','cats channel'])assert(master.includes(t),t);
assert(JSON.parse(fs.readFileSync('Master prompts/INDEX.json','utf8')).some(x=>x.id===p.id));
assert(master.includes('Does your cat do this too?')&&master.includes('first 1–2 seconds'));
const C=require('../cats_behavior_contract'),W=require('../write_story');
assert.equal(W.normaliseCast(p,[])[0].name,'Milo');
assert(W.normaliseCast(p,[])[0].description.includes('slightly fluffy'));
assert(W.castPrompt(p,[]).includes('Milo'));
assert(C.houseCast('pregnancy')[1].name==='Luna');
assert.equal(p.content_pillars.reduce((n,x)=>n+x.titles.length,0),70);
for(const key of ['style','palette','camera','sound_style','narration_voice'])assert.equal(p[key],z[key],key);
assert(p.direction.startsWith(z.direction),'Zack production rules remain inherited');
const noCast=text.replace(/Miso: Adult orange tabby[^\n]+/,'None').replace(/Miso/g,'cat');
const fixed=I.prepare(I.parse(noCast)[0],'9:16');
assert.equal(fixed.cast[0].name,'Milo');assert(fixed.story.scenes[0].characters.includes('milo'));
const family={...parsed,characters:[...parsed.characters,
 {name:'Luna',description:'Adult female cream-and-silver tabby, amber eyes.'},
 {name:'Kittens',description:'Newborn kittens, natural feline anatomy and age-appropriate movement.'}]};
const familyResult=I.prepare(family,'9:16');
assert.equal(familyResult.cast.length,3,'cat-family imports must preserve every supplied reference');
assert.deepEqual(familyResult.cast.map(c=>c.name),['Miso','Luna','Kittens']);
assert.equal(I.prepare({...family,preset:'3d-zack-style'},'9:16').cast.length,3,'shared Zack importer must allow topic-required cast');
assert.equal(I.prepare({...family,preset:'intimacy-health-3d'},'9:16').cast.length,3,'health importer must preserve topic-required cast too');
console.log('PASS: cats preset preserves Zack visual DNA, ten pillars, Milo identity and 70 title seeds, feline cast, strict importer pacing, native/audio-first badge prompts and master catalog. No live API calls.');
