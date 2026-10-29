const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),I=require('../import_ready_script'),R=require('../ready_script_report');
const text=`Story 1
Title: The Depot Investigation
Preset: fern-documentary
Details:
Duration: 16 seconds. Exactly 2 clips of 8 seconds.
Story brief: A sourced reconstruction of a missing cash shipment and the resulting investigation.
Sources: Supplied factual transcript, reconstruction visuals only.
Clip 1:
Narration: "How did cash disappear from a guarded depot? The investigation began with a missing shipment and conflicting records."
Shot 1: 0–3 seconds — A faceless worker mannequin checks sealed containers in the industrial depot.
Shot 2: 3–5 seconds — Track along the cart to a gap where a container was expected.
Shot 3: 5–8 seconds — Pan toward an investigator mannequin opening a supplied record folder; no invented document text.
Sound: Quiet wheels and paper under narration. No music.
Clip 2:
Narration: "Investigators compared the available records. The cause remained uncertain, so this reconstruction does not invent an answer."
Shot 1: 0–4 seconds — A faceless investigator mannequin compares records in an office.
Shot 2: 4–8 seconds — Pan to the adjacent evidence shelf and settle on the unmatched container tag.
Sound: Room ambience only.
`;
const source=I.parse(text)[0];assert.equal(source.story_brief.startsWith('A sourced'),true);assert(source.sources.includes('Supplied'));
assert.deepStrictEqual(I.semanticKey(I.parse(R.exportScript(source))[0]),I.semanticKey(source));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fern-ready-'));let log=console.log;console.log=()=>{};
try{
 const [file]=I.run({text,out:temp});const story=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(story.scenes.length,2);assert(story.fern_ready_import);assert(story.narrated);assert(story.silent_cast);
 assert.deepStrictEqual(story.scenes.map(s=>s.script_line),source.clips.map(c=>c.narration));assert.equal(story.scenes[0].shots.length,3);assert.equal(story.scenes[1].shots.length,2);
 const prompt=fs.readFileSync(path.join(path.dirname(file),'clip_prompts/clip_001.txt'),'utf8');
 for(const term of ['faceless matte mannequin','Quiet wheels','Read the complete line exactly','FACTUAL TOPIC','No music'])assert(prompt.includes(term),term);
 assert(story.imported_sources.includes('Supplied'));assert(fs.readFileSync(path.join(path.dirname(file),'agent_prompt.txt'),'utf8').includes('FRAMING 3'));
}finally{console.log=log;fs.rmSync(temp,{recursive:true,force:true});}
for(const name of fs.readdirSync('Master prompts').filter(n=>n.endsWith('.txt')))assert(fs.readFileSync(path.join('Master prompts',name),'utf8').includes('SHARED PRODUCTION STANDARD — 2026-10 UPDATE'),name);
console.log('PASS: Fern local import metadata, variable clip count, 2/3 shots, exact narration, faceless style, no-music audio, round trip, Agent/individual exports and shared master standards.');
