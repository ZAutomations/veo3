const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const T=require('../thumbnail_prompt'),Q=require('../quiet_power_thumbnail'),{ensure}=require('../ensure_story_thumbnail');
(async()=>{
 const title='She Wanted a Provider, But What Was She Providing?';
 const story={preset_id:'relationship-cinematic-quiet-power',title,aspect_ratio:'9:16',thumbnail:{headline:'She Wanted a Provider,'},character_descriptions:{sam:'Original adult man in a black turtleneck',sarah:'Original adult woman in emerald blouse'},place:{description:'A warm night restaurant'},scenes:[{dialogue:[{speaker:'Sarah',line:'I want a conversation, not another checklist.'}]}]};
 assert(T.isFlowEndcardPreset(story));assert.equal(Q.headline(story),title);
 assert.equal(Q.lines(title).join(' '),title,'all headline words remain in order');
 const prompt=T.thumbnailPrompt(story);
 for(const required of ['QUIET','POWER','white brush-script','black brush-script','vivid red','vivid yellow',title,'emerald blouse','No black bars'.toLowerCase()])assert(prompt.toLowerCase().includes(required.toLowerCase()),required);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quiet-thumb-'));
 try{
  const file=path.join(dir,'sample_story.json');fs.writeFileSync(file,JSON.stringify(story));
  const refs=[{name:'SAM',kind:'character'},{name:'Sarah',kind:'character'},{name:'Venue',kind:'place'}];
  const list=T.withFlowThumbnail(refs,file);
  assert.deepEqual(list.map(r=>r.name),['SAM','Sarah','Venue','Thumbnail']);
  assert.equal(list[3].kind,'thumbnail');assert.equal(list[3].aspect,'9:16');assert.equal(T.withFlowThumbnail(list,file).length,4);
  assert(fs.readFileSync(path.join(dir,'thumbnail_prompt_vertical.txt'),'utf8').includes(title));
  await assert.rejects(()=>ensure(dir,{connect:async()=>{throw Error('Should not connect without project');}}),/THUMBNAIL_REQUIRED/);
  const image=path.join(dir,'thumbnail_downloaded.jpg');fs.writeFileSync(image,Buffer.concat([Buffer.from([0xff,0xd8]),Buffer.alloc(3000)]));
  assert.equal(await ensure(dir,{connect:async()=>{throw Error('Existing thumbnail should be reused');}}),image);
  const friendship=T.thumbnailPrompt({...story,character_descriptions:{sam:'Adult SAM',noah:'Adult male friend Noah'}});
  assert(friendship.includes('noah: Adult male friend Noah'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 console.log('PASS: Quiet Power sample-style full headlines, actual cast, thumbnail after references, repeat-safe reuse and mandatory end-card integration.');
})().catch(e=>{console.error(e);process.exitCode=1;});
