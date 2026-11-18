const assert = require('node:assert/strict');
const single = require('../single_scene_prompts');
const zack = require('../zack_ready_script');
const fern = require('../fern_ready_script');
const audio = require('../audio_first_prompt');

const narration = 'Watch the small valve close while the surrounding chamber stays level.';
const shots = [
 {start_seconds:0,end_seconds:3,visual:'Gently push from the chamber toward the small valve.'},
 {start_seconds:3,end_seconds:6,visual:'The valve slowly closes while the chamber remains level.'},
];
const scene = {shots, script_line:narration, external_narration:narration, audio_first_duration:5.3, full_voiceover_start:0, full_voiceover_end:6};
const heading = 'FEATURE REVEAL — SNAP IN / HOLD / SNAP OUT';
for (const preset_id of ['fern-documentary','3d-zack-style','intimacy-health-3d','cats-behavior-3d']) {
 const isFern = preset_id === 'fern-documentary';
 const story = {
  preset_id, scenes:[scene], place:{name:'Environment'}, aspect_ratio:'9:16', scene_seconds:6,
  fern_ready_import:isFern, zack_ready_import:!isFern,
 };
 const background = {...story,audio_first:true,full_voiceover_first:true};
 const prompts=[
  single.promptForScene(story,0),
  (isFern ? fern : zack).agent(story,{seconds:6}),
  single.promptForScene(background,0),
  audio.agent(background),
 ];
 for (const [index,prompt] of prompts.entries()) {
  assert.equal(prompt.split(heading).length,2,preset_id);
  assert.match(prompt, /0\.20–0\.35s to snap in/);
  assert.match(prompt, /0\.7–1\.2s/);
  assert.match(prompt, /back out in 0\.20–0\.35s/);
  assert(prompt.includes(shots[1].visual));
  assert.equal(prompt.includes(narration),index<2);
  if(index>=2)assert.match(prompt,/NO narration, dialogue, speech/);
  assert.match(prompt, /3-6s/);
 }
}
const quiet = {preset_id:'lofi-anime',scenes:[scene],scene_seconds:6};
assert(!audio.scene(quiet,0).includes(heading));
console.log('PASS: timed feature reveal exported for native single, native Agent, and voiceover-first prompts, with original actions preserved.');
