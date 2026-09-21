// Tests for the content map: analyze_video's ground-truth table reaching
// write_story's prompts so the beats follow the reference's places and order.
//
// Run: node test_content_map.js     (no network)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const W = require('./write_story.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 220) : ''}`); }
}

const cm = {
    title_suggestion: "Borders You Can't Cross",
    preset_suggestion: 'geography-map',
    format: { medium: '2D animated map', clip_seconds: 8, clip_count: 2, narration: true },
    style: 'Clean stylised 2D animated map.',
    segments: [
        { index: 1, t_start: '0:00', t_end: '0:08', places: ['India', 'Pakistan'], point: 'a line of control, not geography', visual: 'push-in to the line' },
        { index: 2, t_start: '0:08', t_end: '0:16', places: ['North Korea', 'South Korea'], point: 'the DMZ', visual: 'the strip darkens' },
    ],
};

console.log('\n--- contentMapBlock formats the ground truth ---');
const block = W.contentMapBlock(cm);
ok('names it a reference content map', /REFERENCE CONTENT MAP \(ground truth/.test(block));
ok('numbers each segment with its time window', /1\. \[0:00-0:08\] India, Pakistan - a line of control/.test(block), block);
ok('carries the visual note', /Visual: push-in to the line/.test(block));
ok('demands the order be kept', /never drop or reorder/.test(block));
ok('keeps place names verbatim', block.includes('North Korea, South Korea'));
ok('no segments means no block', W.contentMapBlock({ segments: [] }) === '');
ok('a missing segments key is tolerated', W.contentMapBlock({}) === '');

console.log('\n--- the newer clips + facts shape is preferred ---');
const rich = {
    clips: [
        { t_start: '0:00', t_end: '0:08', places: ['North Korea', 'South Korea'], points: ['the DMZ, sealed since 1953'], visual: 'zoom to the peninsula' },
        { t_start: '0:08', t_end: '0:16', places: ['Armenia', 'Turkey'], points: ['a closed land border'], visual: 'pan west' },
    ],
    facts: [
        { t: '0:02', places: ['North Korea', 'South Korea'], detail: 'the DMZ, sealed since 1953' },
        { t: '0:05', places: ['Armenia', 'Turkey'], detail: 'a closed land border' },
        { t: '0:06', places: ['Morocco', 'Algeria'], detail: 'a border shut since 1994' },
    ],
};
const richBlock = W.contentMapBlock(rich);
ok('uses the clip plan from "clips"', /1\. \[0:00-0:08\] North Korea, South Korea - the DMZ/.test(richBlock), richBlock);
ok('joins several points with a semicolon when needed',
    W.contentMapBlock({ clips: [{ points: ['a', 'b'] }] }).includes('a; b'));
ok('reprints EVERY fact, so none is lost',
    /EVERY FACT/.test(richBlock) && /Morocco, Algeria \[0:06\]: a border shut since 1994/.test(richBlock), richBlock);
ok('asks for full coverage in order', /Cover EVERY reference clip and EVERY fact below/.test(richBlock));
ok('contentMapClips prefers clips over segments',
    W.contentMapClips({ clips: rich.clips, segments: [{}, {}, {}] }).length === 2);

console.log('\n--- write_story --content-map grounds both calls ---');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3_cm_'));
const file = path.join(dir, 'cm.json');
fs.writeFileSync(file, JSON.stringify(cm), 'utf8');

const out = execFileSync(process.execPath, [
    path.join(__dirname, 'write_story.js'),
    '--content-map', file, '--duration', '48', '--aspect', 'Flow', '--dry-run',
], { encoding: 'utf8' });

ok('the title is taken from the content map',
    /title {4}: Borders You Can't Cross/.test(out), (out.match(/title.*/) || [])[0]);
ok('the preset is taken from the content map',
    /preset {3}: Geography Map[^\n]*\[geography-map\]/.test(out), (out.match(/preset.*/) || [])[0]);
ok('call 1 receives the ground-truth map',
    /DETAIL FROM THE CREATOR: REFERENCE CONTENT MAP/.test(out));
ok('including the first segment with its places',
    /India, Pakistan - a line of control/.test(out));
ok('the beats must follow the map',
    /Cover EVERY reference clip and EVERY fact below/.test(out));
// It has to reach call 2 as well, or the scenes drift from the outline.
const occurrences = (out.match(/REFERENCE CONTENT MAP \(ground truth/g) || []).length;
ok('both call 1 and call 2 see it', occurrences >= 2, 'seen ' + occurrences + ' time(s)');

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
