const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const I=require('../import_ready_script'),R=require('../ready_script_report');
// Representative fixtures, not copies of private user scripts.
function fixture(n=141,strict=true){return `Story ${n}
Title: What Happens If You Hold Your Breath Too Long?
Preset: 3d-zack-style
${strict?'Production profile: zetomate-8x8\n':''}Clip seconds: 8
Estimated duration: 64 seconds
Characters:
None
Locations:
Primary Setting: A non-graphic 3D lung model.
Medical/Technical Cutaway:
Transparent anatomy with amber active mechanisms and cyan context.
Continuity: Preserve anatomy proportions, objects and camera direction.
${Array.from({length:8},(_,i)=>`\nClip ${i+1}:
Narration: “The lung model shows how oxygen moves through vessels while carbon dioxide follows its own separate path.”
Shot 1: 0–3 seconds — Show the lung model expanding beside its connected blood vessels.
Shot 2: 3-5 seconds - Follow oxygen markers through the medical cutaway toward the vessels.
Shot 3: 5—8 seconds —
Reveal the same vessels carrying carbon dioxide back toward the lung.
Effect: 1–7 seconds — Highlight the active vessel without covering it.
Sound: ${i%2?'0–8 seconds — ':''}Quiet piano beneath the exact male narration; soft airflow.
`).join('')}`;}
const text=fixture(),s=I.parse(text)[0];
assert.equal(s.storyNumber,141);assert.equal(s.locations.length,2);assert.equal(s.locations[1].name,'Medical/Technical Cutaway');
assert(s.continuity.startsWith('Preserve'));assert(!s.locations.some(x=>x.name==='Continuity'));
assert(s.locations[1].description.includes('amber'));assert(s.clips[0].shots[2].visual.startsWith('Reveal'));
assert.deepStrictEqual(I.semanticKey(s),I.semanticKey(I.parse(R.exportScript(s))[0]));
const old=I.parse(fixture(51,false).replace('Primary Setting: A non-graphic 3D lung model.\nMedical/Technical Cutaway:\nTransparent anatomy with amber active mechanisms and cyan context.','Reproductive Anatomy Lab: Topic-specific clean stylized realistic 3D setting.'))[0];
assert.equal(old.storyNumber,51);assert.equal(old.locations.length,1);assert(!old.production_profile);
const prepared=I.prepare(s,'9:16');
assert.deepStrictEqual(prepared.story.scenes.map(x=>x.script_line),s.clips.map(x=>x.narration));
const prompt=prepared.story.scenes[0].veo3_prompt;
for(const token of ['Transparent anatomy','Preserve anatomy proportions','SUPPLIED SHOT AUTHORITY','soft airflow','lung model expanding'])assert(prompt.includes(token),token);
const long=text.replace('The lung model shows how oxygen moves through vessels while carbon dioxide follows its own separate path.','This is a deliberately long narration line with more than twenty two words that must remain exactly as supplied without being cut short by the importer.');
assert(I.parse(long)[0].warnings.some(x=>x.includes('above the 22-word target')));
for(const [bad,field] of [
 [text.replace(/Narration:.*\n/,''),'Narration'],
 [text.replace('Clip 2:','Clip 1:'),'Clip'],
 [text.replace('3-5 seconds','4-5 seconds'),'Shot 2'],
 [text.replace('1–7 seconds','1–9 seconds'),'effect'],
 [text.replace('1–7 seconds','-1–7 seconds'),'effect'],
 [text.replace(/Shot 3:.*\nReveal[^\n]*\n/,''),'Shots'],
 [text.replace('Effect:','Music:'),'Music'],
 [text.slice(0,text.indexOf('\nClip 8:')),'Clips'],
 [text.replace(/Sound:.*\n/,''),'sound']
])assert.throws(()=>I.parse(bad),e=>e.permanent&&e.line>0&&e.storyNumber===141&&e.field===field,e=>String(e));
const wrapped=text.replace('Narration: “The lung model shows how oxygen moves through vessels while carbon dioxide follows its own separate path.”','Narration: “The lung model shows how oxygen moves through vessels\nwhile carbon dioxide follows its own separate path.”');
assert.equal(I.parse(wrapped)[0].clips[0].narration,s.clips[0].narration);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zack-upgrade-')),out=path.join(root,'stories');
const log=console.log;console.log=()=>{};
try{
 const preview=I.run({text,preflightOnly:true,quiet:true,out});assert.equal(preview[0].clips,8);assert(!fs.existsSync(out));
 assert.throws(()=>I.run({text:text+'\n'+fixture(142).replace('Clip 8:','Clip 9:'),out}));assert(!fs.existsSync(out));
 const [file]=I.run({text,out});const dir=path.dirname(file);
 for(const name of ['IMPORT_PREFLIGHT.txt','IMPORT_PREFLIGHT.json','READY_SCRIPT_EXPORT.txt','READY_SCRIPT_SOURCE.json','READY_SCRIPT_ORIGINAL.txt'])assert(fs.existsSync(path.join(dir,name)),name);
 fs.writeFileSync(path.join(dir,'checkpoint-sentinel.json'),'completed');
 const storyBefore=fs.readFileSync(file,'utf8');assert.equal(I.run({text,out})[0],file);
 assert.equal(fs.readFileSync(file,'utf8'),storyBefore);assert.equal(fs.readFileSync(path.join(dir,'checkpoint-sentinel.json'),'utf8'),'completed');
 assert.deepStrictEqual(I.semanticKey(I.parse(fs.readFileSync(path.join(dir,'READY_SCRIPT_EXPORT.txt'),'utf8'))[0]),I.semanticKey(s));
}finally{console.log=log;fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS: representative Story 51/141 formats; slash locations, continuity, Unicode/wrapping, exact narration, strict errors, round-trip, preflight, atomic batch validation and repeat import preservation.');
