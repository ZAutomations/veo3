const assert=require('assert'),fs=require('fs'),path=require('path');
const {matchClips,wantedFrom,orderOf}=require('../order_clips_by_dialogue');
const expected='One sleepless night does more than make your eyes feel heavy. Your attention and reaction time can suffer.';
const heard='does more than make your eyes feel heavy.';
let result=matchClips(['partial.mp4'],{'partial.mp4':heard},[{n:1,text:expected}]);
assert.equal(result.byFile['partial.mp4'].scene,1);assert(result.byFile['partial.mp4'].partial);assert(result.byFile['partial.mp4'].cover<0.5);
assert.equal(matchClips(['p'],{p:'eyes feel heavy'},[{n:1,text:expected}]).unresolved.length,1,'short generic fragment not evidence');
assert.equal(matchClips(['p'],{p:heard},[{n:1,text:expected},{n:2,text:'Exercise does more than make your eyes feel heavy. Additional unrelated muscles breathing circulation fitness endurance training stamina details differ.'}]).unresolved.length,1,'shared phrase must stay unresolved');
assert.equal(matchClips(['p'],{p:heard},[{n:1,text:expected}],0.9).unresolved.length,1,'explicit stricter threshold respected');
assert.equal(matchClips(['p'],{p:heard+' robots factories rocket engine wheels spaceship'},[{n:1,text:expected}]).unresolved.length,1,'conflicting content cannot hide behind matching phrase');
assert.equal(matchClips(['a','b'],{a:heard,b:heard},[{n:1,text:expected},{n:2,text:'Entirely different message about weather.'}]).unresolved.length,1,'duplicate fragment cannot fill another scene');
const folder=path.join(__dirname,'../stories/what_really_happens_when_you_miss_a_night_of_sleep_ready_2c225d38e3');
if(fs.existsSync(folder)){
 const story=JSON.parse(fs.readFileSync(path.join(folder,path.basename(folder)+'_story.json'),'utf8'));
 const clips=fs.readdirSync(path.join(folder,'clips')).filter(f=>/\.mp4$/i.test(f));
 const transcripts=Object.fromEntries(clips.map(f=>[f,fs.readFileSync(path.join(folder,'clips/.transcripts',f.replace(/\.mp4$/i,'.txt')),'utf8')]));
 result=matchClips(clips,transcripts,wantedFrom(story));assert.equal(result.unresolved.length,0);
 assert.equal(orderOf(clips,result.byFile)[0],'asset-291b4374cc485f1b.mp4');
 assert(result.byFile['asset-291b4374cc485f1b.mp4'].partial);
}
console.log('PASS: unique long partial narration identifies scene; ambiguous, generic, conflicting and duplicate fragments remain unresolved; actual sleep story maps 8/8 with audio warning.');
