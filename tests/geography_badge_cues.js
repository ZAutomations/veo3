'use strict';
const assert=require('assert'),C=require('../geography_overlay_contract'),G=require('../geography_ready_script');
const s={script_line:'Fire crews and soldiers tried to control the fire beside damaged buildings.',shots:[{start_seconds:0,end_seconds:10,visual:'Firefighters and period soldiers work beside the burning building miniature.'}],sound:'Quiet music.'};
const cues=C.cues(s,10);
assert.deepStrictEqual(cues.map(c=>c.label),['FIRE CREWS','SOLDIERS','FIRE','BUILDINGS']);
assert.equal(cues.find(c=>c.label==='FIRE').phrase,'fire');
assert(C.cues({script_line:'Fire crews arrive.'},10).every(c=>c.label!=='FIRE'));
assert(C.cues({script_line:'A quiet sea surrounds the island.'},10).length===0);
assert(C.cues({script_line:'The Golden Gate Bridge did not exist yet. No soldiers are shown.'},10).length===0);
const prompt=G.scene({title:'The 1906 earthquake',scenes:[s],imported_locations:[],aspect_ratio:'9:16',scene_seconds:10},0,{seconds:10});
for(const c of cues){assert(prompt.includes(`align to "${c.phrase}"`));assert(prompt.includes(c.icon));}
for(const term of ['mandatory audible POPUP SFX','thin animated cyan, amber or red neon contour','natural atlas','BGM beat alone does not count','actual subject'])assert(prompt.includes(term),term);
for(const term of ['perfectly ROUND medallion','110% overshoot','cyan-violet-gold','orbiting arc','radial sparkle burst','central symbol still','mandatory audible exit swoosh','never square/rounded-square','within the existing shot/clip time'])assert(prompt.includes(term),term);
for(const c of cues)assert(prompt.includes(`distinct audible entry popup with perfectly round ${c.icon} medallion`),'Every recognized role needs the round badge audio lifecycle in SOUND');
console.log('PASS: fire crews, soldiers, fire and buildings receive distinct phrase-timed circular badges and paired popup audio; contours preserve the natural map; no flame inferred from fire crews alone.');
