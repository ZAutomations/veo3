const assert = require('assert');
const {withIdentity, MARKER} = require('../reference_identity');
const old = 'Same Sarah throughout - an adult woman in a plain magenta top with a flower-decorated bun.';
const refs = [{name:'Sarah',kind:'character',localFile:'Sarah.png',presetReference:true},
    {name:'SAM',kind:'character',localFile:'SAM.png',presetReference:true}, {name:'Room',kind:'place'}];
const dialogue = 'Sarah (female voice): "I sent three messages yesterday."';
const prompt = `Create two clips.\nScene 1 - Conversation\n${old}\n${dialogue}\nScene 2 - Reply\nSAM (male voice): "I hear you."`;
const result = withIdentity(prompt, refs, {sarah:old}, {agent:true});
assert(!result.includes(old));
assert(result.includes(dialogue));
assert(result.includes('actual named character image assets'));
assert(result.includes('same original image asset IDs'));
assert(result.includes('fabric pattern, neckline, sleeves'));
assert.equal(result.split(MARKER).length-1,3); // batch and both independent scenes
assert.equal(withIdentity(result,refs,{}, {agent:true}),result);
assert.equal(withIdentity(prompt,[{name:'Room',kind:'place'}]),prompt);
assert.equal(withIdentity(prompt,[]),prompt);
// Extend / Ingredients receive the visual lock without Agent tool-call commands.
const direct=withIdentity('Continue the previous clip.',refs,{sarah:old});
assert(direct.includes(MARKER));
assert(!direct.includes('video-generation tool call'));
// A generated reference retains its scene description; only approved local
// references take precedence over previously invented identity text.
assert(withIdentity(old,[{name:'Sarah',kind:'character'}],{sarah:old}).includes(old));
console.log('PASS: per-scene image/wardrobe authority, tool-call reference reuse, stale description removal, dialogue preservation and Extend compatibility.');
