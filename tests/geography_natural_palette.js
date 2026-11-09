const assert=require('assert'),fs=require('fs'),G=require('../geography_ready_script'),theme=require('../geography_map_theme');
const after=JSON.parse(fs.readFileSync('styles.json'));
const preset=after.styles.find(s=>s.id==='geography-map');
assert.equal(preset.style,theme.style);assert.equal(preset.palette,theme.palette);
assert.equal(preset.flow_voice,'Orus');assert(preset.direction.includes('Animated map diorama'));
const story={title:'A battlefield river',style:'old neon terrain',palette:'old rainbow fills',aspect_ratio:'9:16',scene_seconds:10,imported_locations:[],scenes:[{script_line:'The army crosses the river beside city buildings.',shots:[{start_seconds:0,end_seconds:3,visual:'Soldier miniatures approach the blue river.'},{start_seconds:3,end_seconds:6,visual:'Columns cross beside miniature buildings.'},{start_seconds:6,end_seconds:10,visual:'Pull back to both banks.'}],sound:'Soft marching, popup SFX and music.'}]};
const p=G.scene(story,0,{seconds:10});assert(p.includes('Natural atlas-style'));assert(!p.includes('STYLE: old neon'));for(const s of ['Soldier miniatures','miniature buildings','Soft marching','ANIMATED MAP DIORAMA','popup'])assert(p.includes(s));
console.log('PASS: natural base map overrides legacy palette; supplied actions and SFX preserved; preset retains Orus and map-diorama direction.');
