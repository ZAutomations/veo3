'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),P=require('../master_prompt_package');
const base='Story grammar stays unchanged.\nClip seconds: 10\nNarration: "Exact words."\n';
const applied=P.apply(base,'geography-map');assert(applied.startsWith(base.trimEnd()));assert.equal(P.apply(applied,'geography-map'),applied);
const folder=path.join(__dirname,'../Master prompts');let count=0;
for(const f of fs.readdirSync(folder).filter(n=>n.endsWith('.txt')&&!['00_START_HERE.txt','video-reverse-engineering.txt'].includes(n))){
 const t=fs.readFileSync(path.join(folder,f),'utf8');assert.equal(t.split(P.START).length,2,f);assert(t.trimEnd().endsWith(P.END),f);
 for(const field of ['| video_id |','| filename |','| title |','| description |','| Tags |','| thumbnail |'])assert(t.includes(field),f+field);
 for(const requirement of ['Combined_Ready_Import_Scripts.txt','{BatchFolderName}.xlsx','01 Batch 1 to 5 Zack','{StoryTitle}.txt','{StoryTitle}.png','LOCALIZED THUMBNAILS FOR EVERY SELECTED LANGUAGE','exact original English video/story title','{SafeEnglishStoryTitle} {LanguageName}.png','{BatchFolderName} {LanguageName}.xlsx','ONE SEO WORKBOOK PER SELECTED LANGUAGE','Keep this upload-title field in English for EVERY selected language','as the FIRST LINE','NATIVE THUMBNAIL COPY — NOT LITERAL TRANSLATION','THREE short, distinct thumbnail-hook candidates','MANDATORY LANGUAGE-FIRST TOPIC DESIGN — EVERY PRESET','TOPIC MUST BE VISIBLE','REJECT AND REVISE','SHARED CAMERA RHYTHM — ALL COMPATIBLE PRESETS','MANDATORY LANGUAGE WORD LIMITS — HARD AUTHORING GATE','Arabic 16–18 words','MAX 18','LANGUAGE_WORD_COUNT_AUDIT.csv','A single FAIL means NOT READY','ENGLISH BASE + NATIVE ADAPTATION — EVERY LANGUAGE','The finalized ENGLISH script is the content and visual blueprint','SCENE-BY-SCENE VISUAL ALIGNMENT IS MANDATORY','NATURAL, ENGAGING ADAPTATION — NOT WORD-FOR-WORD TRANSLATION','The thumbnail headline is NOT the full upload/video title','PACKAGE_MANIFEST.json','Exactly 15','Exactly 10','exactly 3','Sources:'])assert(t.toLowerCase().includes(requirement.toLowerCase()),f+requirement);
 count++;
}
assert(P.block('genai-space-cel').includes('NASA, ESA'));
assert(P.block('geography-map').includes('national mapping agencies'));
assert(P.block('fern-documentary').includes('court records'));
const generic=require('../ready_import_authoring').contract({id:'genai-space-cel',name:'Space',ready_script_mode:'narrated_visual',style:'2D space diagrams',direction:'Keep diagrams.',camera:'Locked',sound_style:'Quiet narration'});
assert.equal(generic.split(P.START).length,2);assert(generic.includes('Preset: genai-space-cel'));assert(generic.includes('NASA, ESA'));
const reference=require('../reverse_video_contract').masterPrompt({id:'reference-package-test',name:'Package test',style:'Original 2D illustration',direction:'Small gestures.',camera:'Locked camera',sound_style:'Natural foley',ready_script_mode:'silent_visual',reference_cast:[],aspect_ratio:'9:16',default_clips:6,scene_seconds:10});
assert.equal(reference.split(P.START).length,2);assert(reference.trimEnd().endsWith(P.END));assert(reference.includes('No Narration:'));
console.log(`PASS: ${count} saved preset prompts carry the exact six-column V3 package; generic and reverse-engineered future prompts inherit it once; script/identity rules remain present.`);
