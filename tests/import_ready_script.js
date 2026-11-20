const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),I=require('../import_ready_script');
const text=`Story 1
Title: Blanket Negotiations
Preset: relationship-dialogue-dog-couple
Details:
Duration: 16 seconds. Exactly 2 clips of 8 seconds.
Setting: A cozy living room with two dog beds.
Characters: Sarah and SAM.
Clip 1:
Action: Sarah tilts her head.
Sarah: "You stole my blanket again."
SAM: "I was keeping it warm for you."
Clip 2:
Action: SAM rests his paw on the blanket.
SAM: "Sharing is caring."
Sarah: "Then care about your own blanket."`;
const parsed=I.parse(text);assert.equal(parsed[0].clips.length,2);assert.equal(parsed[0].seconds,8);
const withAudioWorkflow=text.replace('Clip 1:', 'Audio workflow: Full Voiceover First\nClip 1:');
assert.deepStrictEqual(I.parse(withAudioWorkflow),parsed);
assert.throws(()=>I.parse(withAudioWorkflow.replace('Clip 1:', 'Audio workflow: Native Veo\nClip 1:')),/Duplicate Audio workflow/);
assert.throws(()=>I.parse(text.replace('Title:', 'Unknown metadata:')),/Unknown script field/);
const withContinuity=text.replace('Clip 1:', 'Locations:\nLiving room: Two dog beds\nVisual continuity: Keep the same blanket.\nClip 1:');
const [continuityStory]=I.parse(withContinuity);
assert.equal(continuityStory.continuity,'Keep the same blanket.');
assert.deepStrictEqual(continuityStory.locations,[{name:'Living room',description:'Two dog beds'}]);
assert.equal(I.parse(require('../ready_script_report').exportScript(continuityStory))[0].continuity,continuityStory.continuity);
assert.throws(()=>I.parse(withContinuity.replace('Clip 1:', 'Continuity: A different blanket.\nClip 1:')),/Duplicate Continuity/);
const counted=text.replace('Story 1','Story 6').replace('Setting:','Clips per story: 2\nSetting:');
const withSubject=counted.replace('Clip 1:', '\n\nSubject: Sharing a blanket\nClip 1:');
assert.equal(I.parse(withSubject)[0].subject,'Sharing a blanket');
assert.throws(()=>I.parse(withSubject.replace('Subject: Sharing a blanket','Subject:')),e=>e.code==='IMPORT_VALIDATION_FAILED'&&e.storyNumber===6&&e.field==='Subject'&&e.line===11);
assert.throws(()=>I.parse(withSubject.replace('Clip 1:', 'Subject: Another topic\nClip 1:')),/Duplicate Subject/);
assert.throws(()=>I.parse(withSubject.replace(/^Setting:.*\n/m,'')),/Every story needs Title: and Setting:/);
assert.equal(I.parse(counted)[0].clips.length,2);
const runtime=counted.replace('Duration: 16 seconds. Exactly 2 clips of 8 seconds.','Clip seconds: 8\nRuntime: 16 seconds');
assert.equal(I.parse(runtime)[0].declaredDuration,16);
const withAspect=counted.replace('Setting:','Aspect ratio: 9:16\nSetting:');
assert.equal(I.parse(withAspect)[0].aspect,'9:16');
assert.throws(()=>I.parse(withAspect.replace('9:16','4:3')),e=>e.code==='IMPORT_VALIDATION_FAILED'&&e.storyNumber===6&&e.field==='Aspect ratio'&&e.line===7);
assert.throws(()=>I.parse(withAspect.replace('Aspect ratio: 9:16','Aspect ratio: 9:16\nAspect ratio: 16:9')),/Duplicate Aspect ratio/);
assert.throws(()=>I.parse(runtime.replace('Runtime: 16 seconds','Runtime: 15 seconds')),/declared duration/);
assert.throws(()=>I.parse(runtime.replace('Runtime: 16 seconds','Runtime: 16 minutes')),/Use Runtime/);
assert.throws(()=>I.parse(runtime.replace('Runtime: 16 seconds','Runtime: 16 seconds\nDuration: 16 seconds')),/Duplicate Duration/);
assert.equal(I.parse(counted.replace('Duration: 16 seconds. Exactly 2 clips of 8 seconds.','Clip seconds: 8'))[0].clips.length,2);
assert.throws(()=>I.parse(counted.replace('Clips per story: 2','Clips per story: 3')),e=>e.code==='IMPORT_VALIDATION_FAILED'&&e.storyNumber===6&&e.field==='Clips per story'&&e.line===6&&/declared clip count/.test(e.message));
assert.throws(()=>I.parse(counted.replace('Clips per story: 2','Clips per story: 0')),/positive integer/);
assert.throws(()=>I.parse(counted.replace('Clips per story: 2','Clips per story: 2\nClips per story: 2')),/Duplicate Clips per story/);
assert.throws(()=>I.parse(counted.replace('Exactly 2 clips','Exactly 3 clips')),/declared clip count/);
assert.throws(()=>I.parse(text.replace('Clip 2:','Clip 3:')),/consecutive/);
assert.throws(()=>I.parse(text.replace('Duration: 16','Duration: 30')),/declared duration/);
assert.throws(()=>I.parse(text.replace('Sarah: "You stole','Unknown: "You stole')),/unknown field/);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ready-script-'));
try{
 const [file]=I.run({text:counted,aspect:'9:16',out:dir});
 const story=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(story.title,'Blanket Negotiations');assert.equal(story.scene_seconds,8);assert.equal(story.character_species,'dog');assert.equal(story.total_scenes,2);
 assert.deepEqual(story.scenes.flatMap(s=>s.dialogue),parsed[0].clips.flatMap(c=>c.dialogue));
 assert(story.scenes[0].veo3_prompt.includes('Sarah tilts her head'));
 for(const name of ['refs.json','SIMPLE_TEST.json','ALL_SIMPLE_CLIP_PROMPTS.txt','ALL_CLIP_PROMPTS.txt','agent_prompt.txt','clip_prompts/clip_001.txt'])assert(fs.existsSync(path.join(path.dirname(file),name)),name);
 fs.writeFileSync(path.join(path.dirname(file),'keep.mp4'),'preserve');
 const [withAspectFile]=I.run({text:withAspect,aspect:'16:9',out:dir});
 assert.equal(withAspectFile,file);
 assert.equal(story.aspect_ratio,'9:16');
 assert.equal(I.parse(fs.readFileSync(path.join(path.dirname(file),'READY_SCRIPT_EXPORT.txt'),'utf8'))[0].aspect,'9:16');
 assert.equal(I.run({text:withSubject,aspect:'9:16',out:dir})[0],file);
 assert.equal(I.parse(fs.readFileSync(path.join(path.dirname(file),'READY_SCRIPT_EXPORT.txt'),'utf8'))[0].subject,'Sharing a blanket');
 assert.equal(I.run({text:counted,aspect:'9:16',out:dir})[0],file);assert.equal(fs.readFileSync(path.join(path.dirname(file),'keep.mp4'),'utf8'),'preserve');
 const human=text.replace('Blanket Negotiations','Human Conversation').replace('relationship-dialogue-dog-couple','relationship-dialogue-ghibli').replace('two dog beds','two chairs');
 const [h]=I.run({text:human,aspect:'16:9',out:dir});const hs=JSON.parse(fs.readFileSync(h,'utf8'));
 assert(hs.scenes[0].veo3_prompt.includes('Sarah tilts her head'));assert(hs.scenes[0].veo3_prompt.includes('Hand-painted 2D'));
 assert.deepEqual(hs.scenes.flatMap(s=>s.dialogue),parsed[0].clips.flatMap(c=>c.dialogue));
 assert.equal(I.parse(text.replace('Duration: 16 seconds. Exactly 2 clips of 8 seconds.','Clip seconds: 6'))[0].seconds,6);
 const batch=I.parse(text+'\n'+human.replace('Story 1','Story 2'));assert.equal(batch.length,2);
 console.log('PASS: local import preserves dialogue/actions, applies dog/Ghibli presets, exports compatible files, validates input and safely preserves repeat imports.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
