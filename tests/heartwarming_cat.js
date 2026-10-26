const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const I=require('../import_ready_script'),C=require('../heartwarming_cat');
const states=[
 'Girl reads on the armchair; Cat crouches beside the rug with the teddy at its front paws.',
 'Girl reads on the armchair; Cat sits by her slipper holding the teddy in its mouth.',
 'Girl looks at Cat by her slipper; the teddy lies beside the slipper.',
 'Girl holds a cream blanket beside the sofa; Cat sits on the rug beside the teddy.',
 'Girl sits inside the glowing sofa fort; Cat stands at its entrance beside the teddy.',
 'Girl and Cat gently cuddle cheek-to-cheek inside the fort; the teddy rests on her lap.'
];
const visuals=[
 ['Rain taps the window; Cat flinches at distant thunder beside its teddy.','Cat picks up the teddy and looks toward Girl.','Low camera tracks Cat to the armchair; it sits by her slipper.'],
 ['Cat sets its teddy beside the slipper and taps her ankle.','Girl closes the book, notices the cat and softens her expression.','Girl lowers her hand toward Cat; the teddy remains by her slipper.'],
 ['Girl gently strokes Cat, then stands; Cat steps onto the rug.','Girl lifts the cream blanket from the sofa while Cat carries the teddy to the rug.','Girl holds the blanket beside the sofa; Cat sits by the teddy on the rug.'],
 ['Girl drapes a blanket over sofa cushions while Cat watches from the rug.','Girl switches on warm fairy lights inside the fort.','Girl sits inside and holds the entrance open; Cat carries the teddy to the entrance and puts it down.'],
 ['Girl lifts Cat and the teddy onto her lap inside the fort.','Girl and Cat rest cheek-to-cheek in a gentle five-second embrace with visible fish bib, soft purring and warm fairy lights.']
];
const text='Story 1\nTitle: The Thunderstorm Fort\nPreset: heartwarming-cat-3d\nClip seconds: 8\nEstimated duration: 40 seconds\nSetting: A cozy apartment living room at night, with an oak armchair, cream sofa, side table, rainy blue window and warm lamp.\n\n'+visuals.map((shots,i)=>`Clip ${i+1}:\nStart state: ${states[i]}\n${shots.map((visual,j)=>`Shot ${j+1}: ${j===0?'0–3':shots.length===2?'3–8':j===1?'3–5':'5–8'} seconds — ${visual}`).join('\n')}\nEnd state: ${states[i+1]}\nAudio: ${i===4?'Warm major strings and celesta':'Wistful minor piano and fingerstyle acoustic guitar'}, same 78 BPM motif, rain, soft paws and ${i===4?'deep purring':'gentle mew'}; no human speech.\n`).join('\n');
const parsed=I.parse(text)[0];assert.equal(parsed.clips.length,5);
assert.throws(()=>I.parse(text.replace('Clip seconds: 8','Clip seconds: 6')),/8-second/);
assert.throws(()=>I.parse(text.replace('Clip 2:\nStart state: '+states[1],'Clip 2:\nStart state: Incorrect reset.')),/exactly repeat/);
assert.throws(()=>I.parse(text.replace('Clip 1:\n','Clip 1:\nNarration: Hello\n')),/no narration/);
assert.throws(()=>I.parse(text.replace('Audio: Wistful','Audio: Girl whispers: "shh"; Wistful')),/not allowed/);
assert.throws(()=>I.parse(text.replace('3–8 seconds — Girl and Cat','6–8 seconds — Girl and Cat')),/cover|cuddle/);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cat-preset-'));
try{
 const [file]=I.run({text,aspect:'9:16',out:temp});const story=JSON.parse(fs.readFileSync(file,'utf8')),dir=path.dirname(file);
 assert.equal(story.total_scenes,5);assert.equal(story.narrated,false);assert.equal(story.narration_scope,'none');assert(!story.flow_voice&&!story.narrator_voice);
 assert.deepEqual(Object.keys(story.character_descriptions),['girl','cat']);assert.equal(story.place.name,'Livingroom');
 const refs=JSON.parse(fs.readFileSync(path.join(dir,'refs.json'),'utf8'));assert.deepEqual(refs.refs.map(r=>r.name.toLowerCase()).sort(),['cat','girl','livingroom']);
 const cast=C.approvedCast({id:C.ID},[]);assert.deepEqual(I.prepare(parsed,'9:16').W.validate(story,cast,{id:C.ID}),[]);
 const agent=fs.readFileSync(path.join(dir,'agent_prompt.txt'),'utf8');assert(agent.includes('Create exactly 5 separate clips'));assert(agent.includes('No narration, dialogue or extra clips.'));assert(!agent.includes('Narrator (V.O.'));
 for(let i=0;i<5;i++){
  const prompt=fs.readFileSync(path.join(dir,'clip_prompts',`clip_${String(i+1).padStart(3,'0')}.txt`),'utf8');
  for(const token of ['@Girl','@Cat','@Livingroom','blue fish','START STATE:','END STATE:','Audio:','78 BPM','No human speech'])assert(prompt.includes(token),token);
  assert(prompt.includes(states[i])&&prompt.includes(states[i+1]));assert.equal(story.scenes[i].script_line,'');
 }
 const range=C.agent(story,{from:4,to:5,aspect:'9:16'});assert(range.includes('Scene 4')&&range.includes('Scene 5')&&!range.includes('Scene 1'));
 const prepared=I.prepare(parsed,'9:16');
 const W=prepared.W;
 assert(W.castPrompt(prepared.p,[]).includes('Never write narration'));
 assert(W.scenesPrompt(prepared.p,cast,[],0,5,[],story.place.description,'').includes('script_line:""'));
 const built=W.buildStory(prepared.p,cast,{description:'A silent fort story',place_description:parsed.setting},parsed.clips.map(c=>({scene_title:c.title,start_state:c.start_state,end_state:c.end_state,shots:c.shots,sound_context:c.sound})));
 assert.equal(built.narrated,false);assert.deepEqual(W.validate(built,cast,prepared.p),[]);
 const preset=I.prepare(parsed,'9:16').p;assert(C.castPrompt(preset,{title:'Test',detail:'A scared cat',count:5,seconds:8,aspect:'9:16'}).includes('Never write narration'));
 assert(C.scenesPrompt(preset,cast,{outline:[]},0,5,{seconds:8}).includes('script_line:""'));
 console.log('PASS: five silent 8s clips import locally, fixed cast/Home refs, native BGM/foley without voice, consistent states, range exports; rejects dialogue, whisper, drift, invalid duration and short finale. No API or media generation.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
