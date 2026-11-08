'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const A=require('../politics_visual_alignment'),P=require('../world_politics_ready_script');
const narration='Household budgets felt painful as groceries, fuel, medical bills and other expenses placed pressure on voters.';
const old={seconds:10,clips:[{number:2,narration,shots:[{start_seconds:0,end_seconds:10,visual:'[RECONSTRUCTION] Anonymous staff examining maps in an office.'}],effect:'None'}]};
assert.throws(()=>A.validate(old),/groceries/,'unrelated office footage must not pass as a grocery/household-cost visual plan');
const repaired={...old,clips:[{...old.clips[0],shots:[{start_seconds:0,end_seconds:10,visual:'[EXPLAINER] Grocery basket, fuel pump, medical bills invoice and other expenses receipt appear in phrase order.'}]}]};
A.validate(repaired);
const cues=A.cues({script_line:narration},10);assert.deepEqual(cues.map(c=>c.label),['GROCERIES','FUEL','MEDICAL BILLS','HOUSEHOLD COSTS']);assert(cues.every(c=>c.at>=0&&c.at<10));
const prompt=A.forScene({}, {script_line:narration},10);
for(const text of ['spoken phrase','GROCERIES','FUEL','MEDICAL BILLS','popup SFX','word timing is an estimate','No invented zero'])assert(prompt.includes(text),text);
assert(!A.forScene({}, {script_line:'Congress sets its legislative agenda.'},10).includes('REQUIRED CUE near'),'unspoken cost icons must not leak into unrelated clips');
const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../outputs/world-politics/voters_visual_revision.json'),'utf8'));
P.validate(source);
const sums={};for(const c of source.clips)for(const s of c.shots){const mode=s.visual.match(/^\[(.*?)\]/)[1];sums[mode]=(sums[mode]||0)+s.end_seconds-s.start_seconds;}
assert.deepEqual(sums,{MAP:40,RECONSTRUCTION:20,EXPLAINER:20});
const story={scene_seconds:10,aspect_ratio:'9:16',narrator_voice:'Alnilam',scenes:[{script_line:narration,shots:repaired.clips[0].shots,effect:'None',sound:'Quiet ambience'}]};
const generated=P.scene(story,0);assert(generated.includes('REQUIRED CUE near'));assert(generated.includes('MEDICAL BILLS'));assert(generated.includes('CLIP CALLOUT AUDIT SOURCE'));
console.log('PASS: rejects mismatched office/cost shots; explicit phrase-linked cost badges/SFX without leaking to other clips; revised story preserves 40/20/20s visual mix. Prompt checks, no generation.');
