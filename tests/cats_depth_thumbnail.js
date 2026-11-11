const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const T=require('../thumbnail_prompt'),C=require('../cats_behavior_contract'),S=require('../single_scene_prompts');
const story={preset_id:'cats-behavior-3d',title:'Why Does Your Cat Rub Its Face on You?',aspect_ratio:'9:16',scene_seconds:10,thumbnail:{headline:'Why Does Your Cat Rub'},character_descriptions:{miso:'Orange tabby with amber eyes and white paws'},scenes:[{script_line:'Cats have scent producing glands around their cheeks, chin, and forehead.',shots:[{start_seconds:0,end_seconds:10,visual:'Show the same cat cheek contacting a chair.'}],characters:['miso']}]};
assert(T.isFlowEndcardPreset(story));
const thumb=T.thumbnailPrompt(story,'9:16');
for(const t of ['CATS APPROVED THUMBNAIL SAMPLE STYLE','rough red paint-brush','golden yellow','blue/teal','WHY DOES YOUR CAT RUB ITS FACE ON YOU?','after character/location references'])assert(thumb.includes(t),t);
assert(!T.isFlowEndcardPreset({preset_id:'not-a-preset'}));
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cats-thumbnail-'));
try{
 const file=path.join(folder,'sample_story.json');fs.writeFileSync(file,JSON.stringify(story));
 const refs=[{name:'Miso',kind:'character'},{name:'Environment',kind:'location'}];
 const prepared=T.withFlowThumbnail(refs,file);
 assert.deepEqual(prepared.map(r=>r.name),['Miso','Environment','Thumbnail']);
 assert.equal(T.withFlowThumbnail(prepared,file).length,3,'No duplicate thumbnail on resume');
 assert(fs.readFileSync(path.join(folder,'thumbnail_prompt.txt'),'utf8').includes('CATS APPROVED'));
 assert(T.thumbnailPrompt(story,'16:9').includes('ONE complete original 16:9'));
 for(const clip of [S.promptForScene(story,0,{seconds:10}),S.promptForScene({...story,audio_first:true,scenes:story.scenes.map(s=>({...s,script_line:'',external_narration:s.script_line,audio_first_duration:9.4}))},0,{seconds:10})]){
  for(const t of ['CATS 3D EXPLANATORY REVEAL','SCENE-SPECIFIC 3D REVEAL PLAN','ACTION -> EXPLANATION -> RESULT','localized','volumetric'])assert(clip.includes(t),t);
 }
 assert.equal(C.forScene({preset_id:'3d-zack-style'},story.scenes[0]),'');
 console.log('PASS: cats-only expressive thumbnail layout, full title, references-before-thumbnail, repeat safety, selected ratio and native/audio-first topic-led 3D process cues without forced anatomy.');
}finally{fs.rmSync(folder,{recursive:true,force:true});}
