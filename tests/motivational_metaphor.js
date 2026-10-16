const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {execFileSync}=require('child_process');
const m=require('../motivational_metaphor');
const p=JSON.parse(fs.readFileSync('styles.json','utf8')).styles.find(p=>p.id===m.ID);
assert(p&&p.cast_count===2&&!p.use_house_cast);
const c={title:'Small Steps Beat Waiting',detail:'Compare procrastination and steady effort.',count:2,seconds:8,aspect:'16:9'};
assert(m.cast(p,c).includes('total 16s'));
assert(m.cast(p,{...c,count:4}).includes('total 32s'));
assert.throws(()=>m.cast(p,{...c,count:5}),/2 or 4/);
const cast=m.approvedCast(p,[{name:'Wrong A'},{name:'Wrong B'}]);
assert.deepEqual(cast.map(c=>c.name),['Red','Green']);
assert(cast[0].description.includes('red')&&cast[1].description.includes('green'));
assert(m.scenes(p,{...c,from:1,to:2,cast,outline:[],place:p.setting}).includes('ONE CONTINUOUS STATIC SHOT'));
for(const duration of [15,30]){
 const dry=execFileSync(process.execPath,['write_story.js','--title',c.title,'--detail',c.detail,'--preset',m.ID,'--duration',String(duration),'--seconds','8','--aspect','16:9','--dry-run'],{encoding:'utf8',windowsHide:true});
 assert(dry.includes(m.LOCK));assert(dry.includes(duration===15?'total 16s':'total 32s'));
}
const writer=require('../write_story');
const story=writer.buildStory(p,cast,{description:'A motivational metaphor.',moral:'Start small.',place_name:'Plane',place_description:p.setting,place_prompt:'Empty white plane.'},Array.from({length:2},()=>({scene_title:'Steady effort',script_line:'Small steady actions create progress while waiting leaves even a good plan completely unfinished.',narrative_context:'Red sits far-left. Green stacks bricks far-right.'})));
assert.equal(story.scenes.length,2);assert(story.scenes.every(s=>s.veo3_prompt.includes('Red always far-left')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'motivational-preset-'));
try{
 const file=path.join(dir,'story.json'),out=path.join(dir,'agent.txt');fs.writeFileSync(file,JSON.stringify(story));
 execFileSync(process.execPath,['story_to_agent_prompt.js',file,'--out',out,'--aspect','16:9'],{stdio:'pipe',windowsHide:true});
 const text=fs.readFileSync(out,'utf8');assert(text.includes(m.LOCK));assert(text.includes('TEXT EXCEPTION'));assert(text.includes('@Red')&&text.includes('@Green'));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS: preset discovery, 15/30-to-16/32 duration mapping, fixed Red/Green cast, static-shot writer and reference-ready Agent prompts; no API calls.');
