const assert=require('assert'),fs=require('fs');
const W=require('../write_story'),I=require('../import_ready_script'),Z=require('../zack_ready_script');
const h=W.loadPreset('intimacy-health-3d'),z=W.loadPreset('3d-zack-style');
for(const key of ['style','whisk','palette','camera','flow_voice','narration_voice','sound_style','avoid'])assert.deepStrictEqual(h[key],z[key],key);
assert(h.cast_idiom.includes('Default Characters: None'));
assert(h.hook_line.includes('Facts Vs Myths Decoded'));
const text=`Story 1
Title: Why Does Your Heart Race Around Someone You Like?
Preset: intimacy-health-3d
Production profile: zetomate-flex
Clip seconds: 10
Estimated duration: 10 seconds
Characters:
None
Locations:
Heart cutaway: A stylised realistic 3D heart cross-section showing muscle chambers and electrical conduction pathways.

Clip 1:
Narration: "Why does your heart suddenly audition for a drum solo around someone you like? Arousal can increase heart rate, but that racing heartbeat alone cannot prove romantic love."
Shot 1: 0-3 seconds — Push toward the beating muscle wall in Heart cutaway.
Shot 2: 3-7 seconds — Track along the visible electrical pathway to the pumping chambers in Heart cutaway.
Shot 3: 7-10 seconds — Pull back from the muscle to reveal the complete Heart cutaway, keeping the same chambers visible.
Effect: 3-7 seconds — A small glowing arrow follows the visible electrical pathway.
Sound: SFX: quiet popup on arrow reveal; BGM: restrained warm pulse; Mix: narration foreground.`;
const result=I.prepare(I.parse(text)[0],'9:16');
assert.equal(result.cast.length,0);assert.equal(result.story.scenes.length,1);
const prompt=Z.scene(result.story,0,{seconds:10});
assert(prompt.includes('Facts Vs Myths Decoded'));assert(prompt.includes('Heart cutaway'));assert(prompt.includes('No talking-head filler'));
assert.equal(result.story.scenes[0].script_line,I.parse(text)[0].clips[0].narration);
const other=Z.scene({...result.story,preset_id:'3d-zack-style'},0,{seconds:10});assert(!other.includes('Facts Vs Myths Decoded'));
const master=fs.readFileSync('Master prompts/intimacy-health-3d.txt','utf8');
for(const s of ['Unavailable Partners','Our Ex','28–30','6, 8, 10 plus custom','Facts Vs Myths Decoded','Adult Presenter','Pregnancy Science vs Myths'])assert(master.includes(s),s);
assert(!master.includes('at most 22 words'));
console.log('PASS: health uses Zack visuals/voice, no forced cast, 10s import, scoped topic contract and master prompt.');
