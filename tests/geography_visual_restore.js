const assert=require('assert'),C=require('../geography_visual_contract'),G=require('../geography_ready_script');
const bad={title:'Stalingrad',aspect_ratio:'9:16',imported_locations:[],scene_seconds:10,scenes:[{script_line:'Fighting pushed into streets and factories.',shots:[{start_seconds:0,end_seconds:10,visual:'Visualize spoken phrase fighting pushed into streets; reveal only evidenced locations, routes, obstacles and consequences.'}]}]};
assert.throws(()=>C.validate({clips:[{number:1,shots:bad.scenes[0].shots}]}),/generic geography shot template/);
for(const visual of ['Period soldier columns crossing the Neman River beside supply wagons.','A visible ship squeezed by moving Antarctic ice floes.','Cavalry miniatures advance beside the Euphrates and settlement buildings.'])C.validate({clips:[{number:1,shots:[{visual}]}]});
const prompt=G.scene(bad,0,{seconds:10});for(const word of ['ANIMATED MAP DIORAMA','soldier-column','factory roofs','non-graphic','ship'])assert(prompt.includes(word));
console.log('PASS: placeholder shots rejected; concrete army/ship/cavalry fixtures accepted; generated prompts retain diorama subject/action rules.');
