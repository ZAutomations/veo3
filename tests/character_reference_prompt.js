const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const prompts=require('../character_reference_prompt'),refs=require('../refs_for_scene');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blank-character-refs-'));
try{
 const story={style:'Photorealistic moody film',character_descriptions:{sam:'Adult man in a black turtleneck.',sarah:'Adult woman in an emerald blouse.'}};
 const file=path.join(dir,'example_story.json');fs.writeFileSync(file,JSON.stringify(story));
 const original={refs:[{name:'SAM',kind:'character',file:'sam.jpg',prompt:''},{name:'Sarah',kind:'character',file:'sarah.jpg',prompt:''},{name:'Venue',kind:'place',prompt:'Empty dusk restaurant.'}]};
 const refFile=path.join(dir,'refs.json');fs.writeFileSync(refFile,JSON.stringify(original));
 assert(prompts.needsRepair(file));
 const loaded=refs.readRefsFile(refFile);
 assert.equal(loaded.length,3);assert(loaded[0].prompt.includes(story.character_descriptions.sam));assert(loaded[1].prompt.includes(story.character_descriptions.sarah));
 assert.equal(loaded[2].prompt,original.refs[2].prompt);
 assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(story),'runtime repair must preserve story hashes and scene IDs');
 assert.equal(prompts.fill(story,{name:'SAM',kind:'character',prompt:'An approved custom portrait.'}).prompt,'An approved custom portrait.');
 assert.throws(()=>prompts.fill(story,{name:'Unknown',kind:'character',prompt:''}),/RECOVERY_REVIEW_REQUIRED/);
 const server=fs.readFileSync(require.resolve('../mcp_server'),'utf8');
 assert(server.includes('(a.generate_refs || repairCharacterRefs)'),'existing-project retries must restore missing reference preparation');
 console.log('PASS: new/legacy blank character prompts recover only saved identities; location/custom prompts and story hashes remain unchanged; unresolved identities block instead of disappearing.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
