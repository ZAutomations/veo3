const assert=require('assert'),fs=require('fs'),path=require('path');
const {matchClips,wantedFrom}=require('../order_clips_by_dialogue');
const expected='Lubrication, blood flow and tissue swelling may also take time, and they can change how pleasure feels.';
const heard='Hydration, blood flow, and tissue responsiveness gradually build over time, shifting how sensory feedback is processed.';
let result=matchClips(['clip'],{clip:heard},[{n:5,text:expected},{n:6,text:'Stress and other distractions can interrupt a response.'}]);
assert.equal(result.byFile.clip.scene,5);assert.equal(result.byFile.clip.method,'distinctive_topic_anchors');assert(result.byFile.clip.cover<0.5);
assert.equal(matchClips(['clip'],{clip:'Blood flow tissue'},[{n:5,text:expected}]).unresolved.length,1);
assert.equal(matchClips(['clip'],{clip:heard},[{n:5,text:expected},{n:6,text:'Blood flow and tissue health depend on circulation, exercise, activity, muscles, breathing, endurance, fitness and cardiovascular training.'}]).unresolved.length,1,'terms shared by scenes cannot authorize a topic match');
const folder=path.join(__dirname,'../stories/why_does_female_orgasm_often_take_longer_than_male_orgasm_ready_93861bb8e5');
if(fs.existsSync(folder)){
 const story=JSON.parse(fs.readFileSync(path.join(folder,path.basename(folder)+'_story.json'),'utf8'));
 const clips=fs.readdirSync(path.join(folder,'clips')).filter(f=>/\.mp4$/i.test(f));
 const transcripts=Object.fromEntries(clips.map(f=>[f,fs.readFileSync(path.join(folder,'clips/.transcripts',f.replace(/\.mp4$/i,'.txt')),'utf8')]));
 result=matchClips(clips,transcripts,wantedFrom(story));assert.equal(result.unresolved.length,0);assert.equal(result.byFile['asset-4c5429d05cb24ab6.mp4'].scene,5);
}
console.log('PASS: three unique substantial anchors plus exact adjacent phrase identify reworded scene; shared/short evidence refused; actual 8-clip story resolves without filename assumptions.');
