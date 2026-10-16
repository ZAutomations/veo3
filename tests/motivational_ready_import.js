const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const I=require('../import_ready_script'),M=require('../motivational_ready_script'),S=require('../single_scene_prompts');
function source(number,count=2){
 const states=Array.from({length:count+1},(_,i)=>'Red has '+i+' loose rods in a horizontal row at far-left. Green has '+i+' stable blocks in a vertical tower at far-right.');
 return ['Story '+number,'Title: Small Steps '+number,'Preset: 3d-motivational-red-green','Clip seconds: 8','Estimated duration: '+count*8+' seconds','Left label: WAITING','Right label: DOING','Footer start: STARTING OUT','Footer end: ACTION WINS',...Array.from({length:count},(_,i)=>['','Clip '+(i+1)+':','Narration: "'+(i===count-1?'Small steady actions build real progress while waiting leaves the work unfinished today.':'Waiting for a perfect moment can leave good intentions behind small steady actions.')+'"','Start state: '+states[i],'Action: Red moves one loose rod horizontally. Green stacks one block vertically from his own stock. '+(i===count-1?'Complete by 6 seconds and hold silently from 6-8 seconds.':''),'End state: '+states[i+1],'Sound: Quiet block tap.'].join('\n'))].join('\n');
}
const batch=Array.from({length:10},(_,i)=>source(i+1,i%2?4:2)).join('\n\n');
const parsed=I.parse(batch);assert.equal(parsed.length,10);assert.deepEqual(parsed.map(s=>s.clips.length),[2,4,2,4,2,4,2,4,2,4]);
assert.throws(()=>I.parse(source(1).replace('Clip seconds: 8','Clip seconds: 6')),/2 or 4 clips of 8/);
assert.throws(()=>I.parse(source(1).replace('Footer end: ACTION WINS','Footer end: STARTING OUT')),/must change/);
assert.throws(()=>I.parse(source(1).replace('Start state: Red has 1','Start state: Red has 0')),/preceding End state/);
assert.throws(()=>I.parse(source(1).replace('Left label: WAITING','Left label: MINDSET 101')),/branding/);
assert.throws(()=>I.parse(source(1).replace('Narration:','Sarah:')),/no dialogue|Motivational needs/);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'motivational-import-'));
try{
 const files=I.run({text:batch,aspect:'16:9',out:temp});assert.equal(files.length,10);
 for(let i=0;i<files.length;i++){
  const story=JSON.parse(fs.readFileSync(files[i],'utf8')),folder=path.dirname(files[i]);
  assert(story.motivational_ready_import);assert.equal(story.trim_target_seconds,i%2?30:15);assert.equal(story.scenes.length,i%2?4:2);
  assert.deepEqual(Object.keys(story.character_descriptions).sort(),['green','red']);
  assert.equal(story.place.name,'Plane');
  const refs=JSON.parse(fs.readFileSync(path.join(folder,'refs.json'),'utf8')).refs;assert.deepEqual(refs.map(r=>r.name),['Red','Green','Plane']);
  const agent=fs.readFileSync(path.join(folder,'agent_prompt.txt'),'utf8');assert(agent.includes('TEXT EXCEPTION'));assert(agent.includes('ACTION WINS'));assert(!agent.includes('conversation held in one spot'));
  for(let n=0;n<story.scenes.length;n++){
   assert.equal(story.scenes[n].script_line,parsed[i].clips[n].narration);
   const prompt=fs.readFileSync(path.join(folder,'clip_prompts','clip_'+String(n+1).padStart(3,'0')+'.txt'),'utf8');
   assert(prompt.includes(parsed[i].clips[n].action));assert(prompt.includes('Quiet block tap'));assert(prompt.includes('no internal cuts'));assert(prompt.includes('@Red, @Green, @Plane'));
   assert.equal(S.promptForScene(story,n,{aspect:'16:9'}),M.scene(story,n,{aspect:'16:9'}));
  }
  assert(fs.existsSync(path.join(folder,'NARRATION_SCRIPT.txt')));
  assert(!fs.readFileSync(path.join(folder,'HOOK_GUIDE.txt'),'utf8').startsWith('undefined'));
 }
 const subset=M.agent(JSON.parse(fs.readFileSync(files[1],'utf8')),{from:3,to:4,aspect:'16:9'});assert(subset.includes('scene 3 only'));assert(!subset.includes('scene 1 only'));
 const first=files[0];fs.writeFileSync(path.join(path.dirname(first),'keep.mp4'),'keep');assert.equal(I.run({text:source(1),aspect:'16:9',out:temp})[0],first);assert.equal(fs.readFileSync(path.join(path.dirname(first),'keep.mp4'),'utf8'),'keep');
 console.log('PASS: ten local imports, 16/32 timing, Red/Green/Plane references, fixed camera, task continuity, exact narration, labels/footer, standalone and Agent range prompts, repeat preservation; no AI writing.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
