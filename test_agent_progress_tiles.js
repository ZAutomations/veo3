const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
// Run the actual browser snapshot function against the progress-only markup
// observed in this failed run; no browser or generation credits are needed.
const source = fs.readFileSync(require.resolve('./agent_mode'), 'utf8');
const fn = source.match(/function snapshotFn\(\) \{[\s\S]*?\n\}\r?\n/)[0];
function snapshot(texts) {
    const tiles = texts.map(innerText => ({ innerText, querySelector: () => null }));
    return vm.runInNewContext(`(${fn})()`, {
        location: { href: 'https://flow.google.com/project/test' },
        document: {
            querySelector: () => null,
            querySelectorAll: selector => selector === 'flow-video-tile' ? tiles : [],
            body: { innerText: '' },
        },
    }).mediaTiles;
}
const queued = snapshot(['play_circle\n30%\nPeople talking', 'play_circle\n99%\nPeople talking', 'play_circle']);
assert.strictEqual(queued.generating_video_tile, 2);
assert.strictEqual(queued.ready_video_tile, 1);
assert.strictEqual(snapshot(['play_circle\n0%\nPeople talking']).generating_video_tile, 1);
assert.strictEqual(snapshot(['play_circle\n100%\nPeople talking']).ready_video_tile, 1);
assert.strictEqual(snapshot(['play_circle\nGeneration failed']).failed_video_tile, 1);
console.log('PASS: Flow percentage-only progress tiles stay generating until completion.');
