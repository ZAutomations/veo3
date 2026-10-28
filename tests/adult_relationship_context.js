const assert=require('assert');
const {styles}=require('../styles.json');
const safety=require('../adult_relationship_context');
for(const p of styles.filter(p=>p.id.startsWith('relationship-dialogue') && p.id!=='relationship-dialogue-dog-couple')){
 assert(p.adult_relationship_context);
 assert(p.direction.startsWith(safety.RULES));
 if(p.id==='relationship-dialogue-colorful-cartoon') assert(p.direction.includes('Sarah is explicitly 25 and SAM explicitly 28'));
 else assert(p.style.includes(safety.CONTEXT));
 if(p.fixed_couple_appearance){assert(/aged 25/.test(p.fixed_couple_appearance.sarah));assert(/aged 28/.test(p.fixed_couple_appearance.sam));}
}
assert(safety.safeSourceEdit('You either go two rounds or three!', 'You keep pressuring me when I am exhausted.'));
assert(!safety.safeSourceEdit('You either go two rounds or three!', 'Two rounds again tonight.'));
assert(!safety.safeSourceEdit('Do you trust me?', 'Please respect my boundaries.'));
console.log('PASS: all relationship presets identify adult ages, require non-explicit authoring and keep ordinary source fidelity.');
