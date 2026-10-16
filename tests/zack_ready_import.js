const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const I=require('../import_ready_script'),Z=require('../zack_ready_script');
const text=`Story 2
Title: Inside a Charging Phone
Preset: 3d-zack-style
Clip seconds: 8
Estimated duration: 16 seconds
Characters:
None
Locations:
Desk: A desk with the same black phone and cable.
Battery interior: A clear educational battery cross-section.

Clip 1:
Narration: "You connect your phone to a charger, and the battery symbol starts to fill."
Shot 1: 0–3 seconds — Close view of the phone on Desk.
Shot 2: 3–5 seconds — A hand inserts the cable.
Shot 3: 5–8 seconds — The battery icon rises slightly.
Effect: 5–8 seconds — Highlight the icon.
Sound: 3 seconds — Soft click.

Clip 2:
Narration: "Inside the battery, charging rearranges materials through a controlled chemical process."
Shot 1: 0–4 seconds — Educational cross-section at Battery interior.
Shot 2: 4–8 seconds — Return to the same charging phone on Desk.
Effect: None
Sound: 4 seconds — Quiet whoosh.`;
const parsed=I.parse(text)[0];assert.equal(parsed.clips.length,2);assert.equal(parsed.characters.length,0);
assert.throws(()=>I.prepare(I.parse(text.replace('Close view of the phone on Desk.','A cross-section or physical consequence of a family room.'))[0],'9:16'),/generic.*template/);
assert.throws(()=>I.parse(text.replace('3–5 seconds','4–5 seconds')),/gap, overlap/);
assert.throws(()=>I.parse(text.replace('5–8 seconds — The battery','5–9 seconds — The battery')),/endpoint/);
assert.throws(()=>I.parse(text.replace('3 seconds — Soft click','9 seconds — Soft click')),/outside/);
assert.throws(()=>I.parse(text.replace('16 seconds','24 seconds')),/declared duration/);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zack-ready-'));
try{
 const [file]=I.run({text,aspect:'9:16',out:dir});const story=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(story.total_scenes,2);assert.equal(story.scene_seconds,8);assert(story.narrated);assert(story.silent_cast);
 assert.equal(story.flow_voice,'Alnilam');assert.equal(story.imported_locations.length,2);
 assert.deepEqual(story.scenes.map(s=>s.script_line),parsed.clips.map(c=>c.narration));
 const folder=path.dirname(file);const prompt=fs.readFileSync(path.join(folder,'clip_prompts','clip_001.txt'),'utf8');
 for(const item of ['0-3s','5-8s','Highlight the icon','Soft click','cyan-blue','Read this complete line exactly','No music'])assert(prompt.includes(item),item);
 const agent=fs.readFileSync(path.join(folder,'agent_prompt.txt'),'utf8');assert(agent.includes('Soft click'));assert(agent.includes('Battery interior'));assert(agent.includes('No added CTA'));assert(!agent.includes('NARRATION: (none found'));
 assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'refs.json'),'utf8')).refs.length,1);
 assert.equal(require('../dog_couple').savedForStory(file,'agent',{agent_saved_couple:true,couple_sarah_file:'missing'}),null);
 const withCast=text.replace('None\nLocations:', 'Passenger: Adult traveller in a plain blue shirt and grey trousers.\nLocations:').replace('A hand inserts','Passenger inserts');
 const out=I.prepare(I.parse(withCast)[0],'9:16');assert(out.story.character_descriptions.passenger.includes('plain blue shirt'));assert(out.story.scenes[0].characters.includes('passenger'));assert(Z.scene(out.story,0).includes('@Passenger'));assert(!Z.scene(out.story,1).includes('@Passenger'));
 assert(Z.scene(story,1).includes('Quiet whoosh'));
 assert(Z.scene(story,0).includes('FILM TOPIC: Inside a Charging Phone'));
 assert(Z.scene(story,0).includes('TOPIC-LED VISUALS'));
 const plate=JSON.parse(fs.readFileSync(path.join(folder,'refs.json'),'utf8')).refs[0].prompt;
 assert(plate.includes('One coherent environment'));
 assert(!plate.includes('Battery interior:'));
 console.log('PASS: Zack D exact narration, timed cuts/effects/sounds, named locations, optional cast, refs, Agent/individual exports, eight-second coverage validation; no AI calls.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
