const assert=require('assert');
const brief=require('../relationship_writing_brief');
const presets=require('../styles.json').styles.filter(brief.applies);
const script='Sarah: Why do we stop listening?\nSAM: We can choose to listen again.';
for(const p of presets){
 const context={title:'Listening',detail:script,count:5,seconds:8,aspect:'9:16',houseCast:[],source:null};
 const prompt=brief.cast(p,context);
 assert(prompt.includes(script));assert(prompt.includes('0.30'));assert(prompt.includes('woman aged 25'));assert(prompt.includes('man aged 28'));
 assert(prompt.includes(p.style));assert(prompt.includes('exactly 5'));
 assert(!prompt.includes('underage sexual'));assert(prompt.length<7000);
 const scenes=brief.scenes(p,{...context,cast:[],outline:[{},{}],from:0,to:2,previous:[],place:'Kitchen'});
 assert(scenes.includes('ONLY CLIPS 1 THROUGH 2'));assert(scenes.includes(script));
}
assert(!brief.applies({id:'fern-documentary',dialogue_prompt_format:'minimal-test'}));
console.log('PASS: compact relationship authoring preserves approved style, adult identities, source words, order and pause; other presets unchanged.');
