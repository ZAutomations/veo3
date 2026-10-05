const assert = require('assert');
const W = require('./write_story');
const {locationPrompt,brightVisualText,withBrightLocation} = require('./location_style');
const real = W.loadPreset('relationship-dialogue-real');
const place = {description:'An empty sitting room with a cream sofa, sage walls and honeyed afternoon light.',prompt:'Hand-painted 2D animation with delicate outlines and soft watercolor shading.'};
const fixed = locationPrompt(real,place);
assert(fixed.startsWith('Photorealistic location photograph'));
assert(fixed.includes(brightVisualText(place.description)));
assert(!fixed.includes(place.prompt));
assert(fixed.includes('No cartoon, anime'));
assert(locationPrompt(W.loadPreset('relationship-dialogue-ghibli'),place).startsWith(place.prompt));
assert(locationPrompt(W.loadPreset('relationship-dialogue-ghibli'),place).includes('Bright, clean, airy'));
const prompt = W.castPrompt(real,[]);
assert(prompt.includes('LOCATION MEDIUM: Photorealistic architectural interior photography'));
assert(prompt.includes('never copy an incompatible medium from saved character sheets'));
const story = W.buildStory(real,[{name:'Sarah',gender:'female',description:'Woman'},{name:'George',gender:'male',description:'Man'}],
    {description:'Conversation',place_name:'Sittingroom',place_description:place.description,place_prompt:place.prompt},
    [{dialogue:[{speaker:'Sarah',line:'Let us talk.'},{speaker:'George',line:'I am listening.'}],characters:['sarah','george'],narrative_context:'They sit.'}]);
assert.strictEqual(story.place.prompt,fixed);
for (const name of ['Kitchen','Bedroom','Garden']) {
    const prompt = locationPrompt(real,{description:`A ${name} in dimly lit late afternoon with murky shadows.`,prompt:'Cartoon'});
    assert(prompt.includes(name) && prompt.includes('luminous white and ivory') && prompt.includes('clear daytime'));
    assert(!prompt.includes('dimly lit') && !prompt.includes('late afternoon'));
    if (name === 'Garden') assert(prompt.includes('Gardens stay recognizably outdoors'));
}
const guarded = withBrightLocation(story,'[SHOT] A dimly lit room at twilight.\n[AUDIO] Sarah says "We met at twilight."');
assert(guarded.includes('brightly daylit room at clear daytime'));
assert(guarded.endsWith('[AUDIO] Sarah says "We met at twilight."'));
assert.strictEqual(locationPrompt({id:'true-crime'},place),place.prompt);
console.log('PASS: all relationship locations use bright daylight; Realistic stays photographic, Ghibli keeps its medium; gardens remain outdoors; dialogue and other presets unchanged.');
