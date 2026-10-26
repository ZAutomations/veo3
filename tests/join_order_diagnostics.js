'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {resolveSceneManifest} = require('../download_tile_logic');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-order-'));
try {
    const clips = path.join(tmp, 'clips');
    fs.mkdirSync(path.join(clips, '.transcripts'), {recursive:true});
    const lines = ['Satellites provide navigation signals.', 'Undersea cables carry internet traffic.'];
    fs.writeFileSync(path.join(tmp, 'sample_story.json'), JSON.stringify({scenes:lines.map(script_line=>({script_line}))}));
    const index = {};
    for (const file of ['asset-a.mp4', 'asset-b.mp4']) {
        fs.writeFileSync(path.join(clips, file), 'fixture');
        const st = fs.statSync(path.join(clips, file));
        index[file] = {size:st.size, mtime:st.mtimeMs};
        fs.writeFileSync(path.join(clips, '.transcripts', file.replace('.mp4','.txt')), lines[0]);
    }
    fs.writeFileSync(path.join(clips, '.transcripts/index.json'), JSON.stringify(index));
    fs.writeFileSync(path.join(clips, 'manifest.json'), JSON.stringify({expected:2,complete:false,clips:Object.keys(index).map(file=>({file,got:true,order_verified:false}))}));
    const result = spawnSync(process.execPath, [path.join(root,'join_clips.js'),clips], {encoding:'utf8'});
    assert.equal(result.status,2);
    assert.match(result.stdout,/Checking story order/);
    assert.match(result.stderr,/Missing verified story scenes: 2/);
    assert.match(result.stderr,/repeats narration from Scene 1/);
    assert(!result.stdout.includes('Or without touching the manifest'));
    assert.match(result.stderr,/RECOVERY_REVIEW_REQUIRED:/,'unchanged unresolved ordering must stop the automatic retry loop');
    const rerun = spawnSync(process.execPath, [path.join(root,'join_clips.js'),clips], {encoding:'utf8'});
    assert.equal(rerun.status,2);
    assert.match(rerun.stdout,/Checking story order/,'saved partial manifest gets a new local resolution check on explicit Join');
    assert.match(rerun.stderr,/RECOVERY_REVIEW_REQUIRED:/);
    const manifest = JSON.parse(fs.readFileSync(path.join(clips,'manifest.json')));
    assert.equal(manifest.complete,false);
    assert.deepEqual(manifest.missingScenes,[2]);
    assert(fs.readFileSync(path.join(clips,'CLIP_ORDER.txt'),'utf8').includes('Missing verified scenes: 2'));
    const verified = resolveSceneManifest({expected:1,complete:false,clips:[{file:'one.mp4',matched_scene:1,match_cover:1,order_verified:false}]});
    assert.equal(verified.complete,true);
    assert.equal(verified.clips[0].order_verified,true);
    console.log('PASS: Join resolves locally; duplicate narration blocks joining with missing-scene details; verified mappings clear unknown-order flags.');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
