const assert=require('assert'),A=require('../audio_first_prompt'),G=require('../geography_ready_script'),C=require('../geography_overlay_contract'),F=require('../fast_camera_rhythm'),fs=require('fs');
const scenes=[{script_line:'A hiker crosses the river beneath the mountains while the ship sails toward the port.',shots:[{start_seconds:0,end_seconds:3.2,visual:'A visible hiker walks onto a narrow river bridge.'},{start_seconds:3.2,end_seconds:6.5,visual:'Track the mountain pass above the winding river channel.'},{start_seconds:6.5,end_seconds:10,visual:'A recognizable ship sails into the visible miniature port.'}],sound:'Popup and swoosh, footsteps, river and vessel ambience.'}];
const native={title:'Journey',preset_id:'geography-map',geography_ready_import:true,scene_seconds:10,aspect_ratio:'9:16',scenes,imported_locations:[],place:{name:'Terrain'}};
const silent={...native,audio_first:true,full_voiceover_first:true,scenes:scenes.map(s=>({...s,external_narration:s.script_line,script_line:''}))};
for(const prompt of [G.scene(native,0,{seconds:10})]){
 for(const phrase of ['MAP CLIP VISUAL PRIORITIES','SNAP IN / HOLD / SNAP OUT','0.20–0.35s','neon outer circle','VISIBLE-TARGET LOCK','Travel: an actual hiker','geographical feature','audible POPUP','audible short SWOOSH','No grey rectangular badge cards','Muted terrain does NOT mean muted overlays'])assert(prompt.includes(phrase),phrase);
}
assert(!A.scene(silent,0).includes('Read exactly:'));
assert(!A.scene(silent,0).includes(scenes[0].script_line),'external narration must not leak as spoken tool prompt');
const labels=C.cues(silent.scenes[0],10).map(c=>c.label);
for(const label of ['TRAVELLER','RIVERS','MOUNTAINS','SHIPS','PORTS'])assert(labels.includes(label),label);
assert(C.cues({script_line:'No soldiers are shown. A hiker walks.'},10).every(c=>c.label!=='SOLDIERS'));
assert(F.detailBeat(native));assert(!F.detailBeat({preset_id:'lofi-anime'}));
assert(!A.scene({...silent,preset_id:'3d-zack-style',geography_ready_import:false},0).includes('MAP CLIP VISUAL PRIORITIES'));
assert(fs.readFileSync('Master prompts/geography-map.txt','utf8').includes('[BEGIN MAP VISUAL DELIVERY PRIORITY'));
console.log('PASS: map Native/Full Voiceover share colourful round neon badges, tracked target highlights, snap-in/hold/out and non-war subject actions; silent narration stays external, other presets remain separate.');

const single=require('../single_scene_prompts');const generic={...native,geography_ready_import:false,narrated:true};assert(single.promptForScene(generic,0).includes('MAP CLIP VISUAL PRIORITIES'));

const compiled=A.scene(silent,0,{seconds:10,aspect:'9:16'});
for(const term of ['CAMERA PHASES','3 TIMES larger','HOLD that same readable close framing','RAPID ZOOM/DOLLY OUT','neon OUTER CIRCLE','audible POPUP','audible SWOOSH','copy','hiker'])assert(compiled.toLowerCase().includes(term.toLowerCase()),term);
assert(compiled.length<10000,'map tool prompt should remain concise');
