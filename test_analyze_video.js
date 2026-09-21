// Tests for analyze_video.js - the reference-video analyser.
//
// The Gemini call itself needs a key and a video, so this covers the two pure
// pieces that shape its output (buildDetail, buildPrompt) and the CLI's refusal
// to run without a URL. No network.
//
// Run: node test_analyze_video.js
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('./analyze_video.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 220) : ''}`); }
}

const cm = {
    format: { medium: '2D animated map', clip_seconds: 8, clip_count: 2, narration: true, on_screen_text: true },
    style: 'Clean stylised 2D animated map, glowing borders, cool blues.',
    narration: 'calm curious male voice',
    never_change: 'the same map style and palette',
    segments: [
        { places: ['India', 'Pakistan'], point: 'a line of control, not geography', visual: 'push-in to the line' },
        { places: ['North Korea', 'South Korea'], point: 'the DMZ, most militarised border', visual: 'the strip darkens' },
    ],
};

console.log('\n--- buildDetail turns the analysis into a creator brief ---');
const d = A.buildDetail(cm);
ok('names the genre from the medium', /^Genre: 2D animated map explainer\./.test(d), d.split('\n')[0]);
ok('carries the aesthetic paragraph', d.includes('Clean stylised 2D animated map'));
ok('summarises the format', /Format: 2 clips of 8s, narrated voice-over\./.test(d), d);
ok('notes the reference had on-screen text', !/no on-screen text/.test(d));
ok('beats are numbered and in order',
    /1\. India, Pakistan - a line of control, not geography \(visual: push-in to the line\)/.test(d) &&
    d.indexOf('India') < d.indexOf('North Korea'),
    d);
ok('the beats sit under a Beats: header', /Beats:/.test(d));
ok('an unknown format does not print undefined', !/undefined/.test(A.buildDetail({})));

console.log('\n--- buildPrompt demands an exhaustive map, not a compressed one ---');
const p = A.buildPrompt();
ok('names the clip length it plans to', /about 8 seconds/.test(p), p.slice(0, 200));
ok('asks for an exhaustive facts list', /"facts"/.test(p));
ok('asks for a clip plan', /"clips"/.test(p));
ok('asks for real place names and timings', /"places"/.test(p) && /"t_start"/.test(p) && /"points"/.test(p));
ok('says fast videos name many places', /often name MANY countries/i.test(p));
ok('forbids merging or skipping places', /Do not merge two different countries/i.test(p));
ok('says never to drop a fact to shorten', /NEVER drop a fact/i.test(p));
ok('forbids copying the script', /Never reproduce the narrator/i.test(p));
ok('forbids real people and brands', /No real people, channels, brands/i.test(p));
ok('lists the preset ids so it can suggest one',
    /geography-map - Geography Map/.test(p) && /3d-map - 3D Map/.test(p));

console.log('\n--- the clip plan is read from "clips", with "segments" still accepted ---');
ok('prefers clips',
    A.clipItems({ clips: [{ index: 1 }], segments: [{ index: 1 }, { index: 2 }] }).length === 1);
ok('falls back to segments', A.clipItems({ segments: [{ index: 1 }] }).length === 1);
ok('tolerates neither', A.clipItems({}).length === 0);

console.log('\n--- buildDetail prints the full fact list ---');
const withFacts = A.buildDetail({
    format: { medium: '3D satellite map', clip_seconds: 8 },
    style: '3D satellite globe.',
    facts: [
        { t: '0:02', places: ['North Korea', 'South Korea'], detail: 'the DMZ, sealed since 1953' },
        { t: '0:05', places: ['Armenia', 'Turkey'], detail: 'a closed land border' },
    ],
    clips: [
        { t_start: '0:00', t_end: '0:08', places: ['North Korea', 'South Korea'], points: ['the DMZ, sealed since 1953'], visual: 'zoom to the peninsula' },
    ],
});
ok('lists every fact', /North Korea, South Korea \[0:02\]: the DMZ, sealed since 1953/.test(withFacts), withFacts);
ok('and the second fact too', /Armenia, Turkey \[0:05\]: a closed land border/.test(withFacts));
ok('under an EVERY FACT header', /EVERY FACT/.test(withFacts));

console.log('\n--- the CLI needs a URL ---');
let code = 0, err = '';
try {
    execFileSync(process.execPath, [path.join(__dirname, 'analyze_video.js')], { encoding: 'utf8', stdio: 'pipe' });
} catch (e) { code = e.status; err = String(e.stderr || ''); }
ok('no URL exits 1', code === 1, String(code));
ok('and prints the usage line', /Usage: node analyze_video\.js/.test(err), err.slice(0, 140));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
