const assert=require('assert'),P=require('../geography_background_prompt');
const scene={shots:[{start_seconds:0,end_seconds:1.2,visual:'A city marker remains visible.'},{start_seconds:1.2,end_seconds:5,visual:'Coalition tanks cross the border. At approximately 0.8s add readable “MARCH 2003”. Use a restrained glowing pointer and hold the feature in frame; complete a motivated 0.4–0.6s continuous camera move, then settle.'},{start_seconds:5,end_seconds:10,visual:'Continue camera pan across the geographical region.'}]};
const p=P.cameraPlan(scene,10);assert.equal(p.shot,1);assert.equal(p.target,'Coalition tanks');assert(p.begin>=1.2&&p.outside<=5);assert(p.inside>p.begin&&p.hold>p.inside&&p.outside>p.hold);assert(p.text.includes('3 TIMES larger'));
const brief=P.cleanShot(scene.shots[1]);assert(brief.includes('Coalition tanks cross the border'));assert(brief.includes('MARCH 2003'));assert(brief.includes('At 1.4s'));assert(!brief.includes('restrained glowing pointer'));
assert.equal(P.cameraPlan({shots:[{start_seconds:0,end_seconds:.8,visual:'A short transition.'}]},10),null);
assert(!scene.shots[1].visual.includes('CAMERA PHASES'),'source story stays unchanged');
console.log('PASS: feature-specific in/hold/out timings are inside one eligible shot, preserve real subjects/dates, rebase out-of-window label times and do not alter source shots.');

assert(p.hold-p.inside>=2&&p.hold-p.inside<=2.801,'close-up must remain legible for at least two seconds');
assert.equal(P.cameraPlan({shots:[{start_seconds:0,end_seconds:2.7,visual:'A ship sails.'}]},10),null,'do not compress the hold into a blink in a short shot');
