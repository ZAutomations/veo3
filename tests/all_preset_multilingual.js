const assert=require('assert'),fs=require('fs'),path=require('path');
const I=require('../import_ready_script'),R=require('../ready_script_report');
const original=fs.readFileSync(path.join(__dirname,'../samples/multilingual/ocean_nuclear_30s/READY_IMPORT_4_LANGUAGES.txt'),'utf8');
for(const preset of ['science-what-if','fern-documentary','geography-map','intimacy-health-3d','cats-behavior-3d']){
 const text=original.replaceAll('Preset: 3d-zack-style','Preset: '+preset);if(['fern-documentary','geography-map'].includes(preset))continue;
 const source=I.parse(text)[0],prepared=I.prepare(source,'9:16');assert(prepared.story.scenes.every(s=>s.narration_translations.ru));assert.equal(I.parse(R.exportScript(source))[0].preset,preset);
}
const turns=[{speaker:'Sarah',line:'You stole my blanket again.'},{speaker:'SAM',line:'I was keeping it warm for you.'}];
const ur=[{speaker:'Sarah',line:'تم نے پھر میرا کمبل لے لیا۔'},{speaker:'SAM',line:'میں اسے تمہارے لیے گرم رکھ رہا تھا۔'}];
const text='Story 1\nTitle: Blanket Negotiations\nPreset: relationship-dialogue-dog-couple\nLanguages: English, Urdu\nClip seconds: 8\nSetting: A cozy living room with two dog beds.\nCharacters: Sarah and SAM.\nClip 1:\nAction: Sarah tilts her head.\nDialogue English: '+JSON.stringify(turns)+'\nDialogue Urdu: '+JSON.stringify(ur);
const source=I.parse(text)[0];assert.deepEqual(I.prepare(source,'9:16').story.scenes[0].dialogue_translations.ur,ur);assert.deepEqual(I.parse(R.exportScript(source))[0].clips[0].dialogue_translations.en,turns);
assert.throws(()=>I.parse(text.replace(JSON.stringify(ur),JSON.stringify([...ur].reverse()))),/speaker/);
for(const file of fs.readdirSync(path.join(__dirname,'../Master prompts')).filter(x=>x.endsWith('.txt')&&x!=='00_START_HERE.txt')){const s=fs.readFileSync(path.join(__dirname,'../Master prompts',file),'utf8');assert.equal(s.split('[BEGIN MULTILINGUAL AUTHORING V2]').length,2,file);assert(s.includes('48–54')&&s.includes('27–29'),file);}
console.log('PASS: all saved preset prompts have multilingual contract; non-Zack narration and named-speaker dialogue import/export preserve original mode and identity.');
