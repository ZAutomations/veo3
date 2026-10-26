const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const W=require('../write_story'),I=require('../import_ready_script'),Z=require('../zack_ready_script'),S=require('../single_scene_prompts');
const p=W.loadPreset('3d-zack-style');assert.equal(p.default_duration,64);assert.equal(p.extra_cta_clip,false);assert.equal(p.flow_voice,'Alnilam');assert(!p.ask_line);assert(!/no background music/i.test(p.avoid));assert(p.direction.includes('No extra CTA'));assert(!p.direction.includes('THEN append')); 
const music='SFX: 3 seconds — Soft click; BGM: sparse original curious synth, gentle pulse, low intensity; Mix: narration foreground, quiet music and restrained effects.';
const clips=Array.from({length:8},(_,i)=>'Clip '+(i+1)+':\nNarration: "This exact narration segment explains one relevant feature clearly without adding a new unrelated idea."\nShot 1: 0–4 seconds — View the same phone on Desk.\nShot 2: 4–8 seconds — Push into its educational battery diagram.\nEffect: None\nSound: '+music).join('\n\n');
const text='Story 1\nTitle: Inside a Charging Phone\nPreset: 3d-zack-style\nClip seconds: 8\nEstimated duration: 64 seconds\nCharacters:\nNone\nLocations:\nDesk: Kitchen desk with the same phone.\n\n'+clips;
const parsed=I.parse(text)[0],prepared=I.prepare(parsed,'9:16'),story=prepared.story;
assert.equal(story.scenes.length,8);assert(story.scenes.every(s=>s.sound===music));
for(let i=0;i<8;i++){const prompt=S.promptForScene(story,i);assert(prompt.includes(music));assert(prompt.includes('NATIVE SOUND:'));assert(prompt.includes('Read this complete line exactly'));assert(prompt.includes('CAMERA-LED TRANSITIONS'));assert(!prompt.includes('No music.'));assert.equal(story.scenes[i].script_line,parsed.clips[i].narration);}
assert(Z.agent(story).includes(music));assert(p.style.includes('Actual story locations look like themselves'));
// Existing imports retain their explicit no-music instruction and clip count.
const previous=I.prepare({...parsed,clips:parsed.clips.slice(0,2).map(c=>({...c,sound:'None'})),declaredDuration:16},'9:16');assert.equal(previous.story.scenes.length,2);assert(Z.scene(previous.story,0).includes('NATIVE SOUND: None'));
const native=W.buildStory(p,[],{description:'Phone charging',place_name:'Desk',place_description:'A kitchen desk'},[{scene_title:'Inside',script_line:'The charging process stores energy inside the battery.',narrative_context:'The camera travels into the battery.',sound_context:music,characters:[]}]);
assert.equal(native.scenes[0].sound_context,music);assert(native.scenes[0].veo3_prompt.includes(music));assert(S.promptForScene(native,0).includes(music));
const generated=W.scenesPrompt(p,[],[{title:'Inside',beat:'Show charging'}],0,1,[],'Desk');assert(generated.includes('sound_context'));assert(generated.includes('same concise story-level musical identity'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zack-v4-'));
try{const file=path.join(dir,'story.json');fs.writeFileSync(file,JSON.stringify(native));const run=cp.spawnSync(process.execPath,[path.resolve(__dirname,'../story_to_agent_prompt.js'),file,'--print'],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert(run.stdout.includes(music));}finally{fs.rmSync(dir,{recursive:true,force:true});}
const master=fs.readFileSync('Master prompts/3d-zack-style.txt','utf8');assert(master.includes('EXACTLY EIGHT VIDEO CLIPS'));assert(master.includes('NICHE-ADAPTIVE BGM'));assert(master.includes('No separate Music: or BGM: parser fields'));
console.log('PASS: V4 default eight clips, no extra CTA, topic-specific settings, native exact narration and Sound/BGM survive ready import, writer, Agent and individual exports; legacy clip counts and explicit None preserved.');
