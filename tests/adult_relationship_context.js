const assert=require('assert');
const {styles}=require('../styles.json');
const safety=require('../adult_relationship_context');
for(const p of styles.filter(p=>p.id.startsWith('relationship-dialogue'))){
 assert(p.adult_relationship_context);
 assert(p.direction.startsWith(safety.RULES));
 assert(p.style.includes(safety.CONTEXT));
 if(p.fixed_couple_appearance){assert(/aged 25/.test(p.fixed_couple_appearance.sarah));assert(/aged 28/.test(p.fixed_couple_appearance.george));}
}
assert(safety.safeSourceEdit('You either go two rounds or three!', 'You keep pressuring me when I am exhausted.'));
assert(!safety.safeSourceEdit('You either go two rounds or three!', 'Two rounds again tonight.'));
assert(!safety.safeSourceEdit('Do you trust me?', 'Please respect my boundaries.'));
console.log('PASS: all relationship presets identify adult ages, require non-explicit authoring and keep ordinary source fidelity.');
