// Tests for the shape a Gemini reply is allowed to arrive in.
//
// The run this exists for: the analysis passed, then the story died with
// "clip batch 1-6 came back empty". The model had answered with the scenes as a
// bare array instead of the {"scenes":[...]} the prompt asked for, the reader
// only understood objects, so it returned the FIRST scene and silently dropped
// the other five - and the stage threw away the whole batch, and with it the
// analysis that had just been paid for.
//
// Run: node test_reply_shape.js     (no network)
const W = require('./write_story.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 220) : ''}`); }
}
function eq(name, got, want) { ok(name, got === want, `${JSON.stringify(got)} !== ${JSON.stringify(want)}`); }

console.log('\n--- the shape the prompt asks for still works ---');
const good = W.parseJson('{"scenes":[{"scene_title":"A"},{"scene_title":"B"}]}');
ok('an object reply parses to an object', !Array.isArray(good) && good.scenes.length === 2);
eq('and scenesFrom takes its scenes', W.scenesFrom(good).length, 2);

console.log('\n--- the bare array is no longer thrown away ---');
// The regression. All six scenes the model wrote, not just the first.
const six = JSON.stringify([1, 2, 3, 4, 5, 6].map((n) => ({ scene_title: `S${n}` })));
const bare = W.parseJson(six);
ok('a bare array parses to an array', Array.isArray(bare), typeof bare);
eq('with every scene still in it', bare.length, 6);
eq('and scenesFrom reads it as the scene list', W.scenesFrom(bare).length, 6);
eq('the first scene is the first one the model wrote', bare[0].scene_title, 'S1');
eq('and the last is the last', bare[5].scene_title, 'S6');

console.log('\n--- the reader still stops at the first value ---');
// A model that emits its JSON and then keeps talking must not swallow the tail.
const chatty = 'Here you go:\n[{"scene_title":"A"}]\nLet me know if you want changes.';
eq('a trailing remark is ignored', W.parseJson(chatty).length, 1);
const twoObjects = '{"scenes":[{"scene_title":"A"}]}\n\nAnd another: {"scenes":[{"scene_title":"B"}]}';
eq('a second object is not glued on', W.parseJson(twoObjects).scenes[0].scene_title, 'A');

console.log('\n--- fences, whitespace and the awkward cases ---');
eq('a ```json fence is stripped', W.parseJson('```json\n{"scenes":[]}\n```').scenes.length, 0);
eq('a bare ``` fence is stripped', W.parseJson('```\n{"scenes":[1]}\n```').scenes.length, 1);
eq('leading whitespace is fine', W.parseJson('   \n {"scenes":[1]}').scenes.length, 1);
eq('an empty array is an array', Array.isArray(W.parseJson('[]')), true);
eq('an array of arrays is not mistaken for an object', Array.isArray(W.parseJson('[[1],[2]]')), true);
ok('a reply with no JSON at all still throws', (() => {
    try { W.parseJson('I cannot help with that.'); return false; } catch (e) { return /JSON/.test(e.message); }
})());
ok('an empty reply throws rather than returning undefined', (() => {
    try { W.parseJson(''); return false; } catch (e) { return true; }
})());

console.log('\n--- a brace or bracket inside a string does not end the value ---');
// The scanner tracks strings; if it did not, this would be cut mid-scene.
const tricky = '[{"scene_title":"a } bracket","script_line":"and a ] one"}]';
const t = W.parseJson(tricky);
eq('a } inside a string is not the end', t.length, 1);
eq('a ] inside a string is not the end', t[0].script_line, 'and a ] one');
const escaped = '[{"script_line":"he said \\"}\\" loudly"}]';
eq('an escaped quote does not open a string', W.parseJson(escaped)[0].script_line, 'he said "}" loudly');

console.log('\n--- an object is preferred when it comes first ---');
// {"scenes":[...]} containing arrays must not be read as an array.
const objFirst = W.parseJson('{"scenes":[[1],[2]],"n":2}');
ok('an object wrapping arrays is still an object', !Array.isArray(objFirst) && objFirst.scenes.length === 2);

console.log('\n--- scenesFrom never invents a scene list ---');
eq('null gives nothing', W.scenesFrom(null).length, 0);
eq('undefined gives nothing', W.scenesFrom(undefined).length, 0);
eq('a string gives nothing', W.scenesFrom('scenes').length, 0);
eq('an object with no scenes gives nothing', W.scenesFrom({ outline: [] }).length, 0);
eq('a scenes key that is not a list gives nothing', W.scenesFrom({ scenes: 'none' }).length, 0);
eq('an empty scenes list gives nothing', W.scenesFrom({ scenes: [] }).length, 0);
eq('an empty array gives nothing', W.scenesFrom([]).length, 0);

console.log('\n--- shapeOf says what actually arrived ---');
eq('an array is described by its length', W.shapeOf([1, 2, 3]), 'an array of 3');
eq('an empty array too', W.shapeOf([]), 'an array of 0');
eq('the hanging keys of a wrong object are named',
    W.shapeOf({ scene_title: 1, script_line: 2, narrative_context: 3 }),
    '{scene_title, script_line, narrative_context}');
eq('an empty object says so', W.shapeOf({}), 'an empty object');
eq('null says null', W.shapeOf(null), 'null');
eq('a string says so', W.shapeOf('x'), 'a string');
eq('only the first few keys are shown, so a huge reply cannot flood a log line',
    W.shapeOf({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }),
    '{a, b, c, d, e, f}');

console.log('\n--- firstJsonValue picks the opener that comes first ---');
eq('an object opener wins when it is first', W.firstJsonValue('{"a":1}'), '{"a":1}');
eq('an array opener wins when it is first', W.firstJsonValue('[1,2]'), '[1,2]');
eq('text before the opener is dropped', W.firstJsonValue('blah [1] blah'), '[1]');
eq('nothing to read gives null', W.firstJsonValue('no json here'), null);
ok('an unterminated array gives null rather than a broken slice',
    W.firstJsonValue('[{"a":1}') === null, String(W.firstJsonValue('[{"a":1}')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
