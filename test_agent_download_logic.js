'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { isVideoRecord, isFailedRecord, loadPriorClips, priorForTile, selectStoryClips, resolveSceneManifest } = require('./download_tile_logic');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-agent-download-'));
try {
    assert.equal(isVideoRecord({ tag: 'flow-video-tile', videoCount: 0 }), true,
        'an off-screen video thumbnail must remain a video');
    assert.equal(isVideoRecord({ tag: 'flow-image-tile', videoCount: 0 }), false);
    assert.equal(isVideoRecord({ tag: 'div', videoCount: 1 }), true);
    assert.equal(isFailedRecord({ caption: 'You have not been charged for this generation.' }), true);
    assert.equal(isFailedRecord({ buttons: [{ aria: 'Retry' }] }), true);
    assert.equal(isFailedRecord({ caption: 'Couple talking', buttons: [{ aria: 'More options' }] }), false);

    fs.writeFileSync(path.join(dir, 'old.mp4'), Buffer.alloc(12000, 7));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ clips: [
        { file: 'old.mp4', tileIndex: 10, caption: 'Holographic map', got: true },
        { file: 'missing.mp4', tileIndex: 11, caption: 'Missing', got: true },
    ] }));
    const prior = loadPriorClips(dir);
    assert.equal(prior.size, 1);
    assert.equal(priorForTile(prior, { index: 10, caption: 'Holographic map' }).bytes.length, 12000);
    assert.equal(priorForTile(prior, { index: 10, caption: 'Different caption' }), null,
        'a changed tile must not inherit unrelated bytes');

    const downloader = fs.readFileSync(path.join(__dirname, 'agent_download.js'), 'utf8');
    assert.match(downloader, /isVideoRecord\(t\) && !isFailedRecord\(t\)/);
    assert.match(downloader, /Duplicate generated assets skipped/);
    assert.match(downloader, /activateVideoTile\(page, t\)/);
    assert.match(downloader, /scanVirtualGrid\(page, log\)/);
    assert.match(downloader, /if \(!downloadState\.downloadComplete\)/);
    const story = {scenes:[{script_line:'A traveller crosses the frozen sea.'},{script_line:'The traveller finally arrives back home.'}]};
    const selection = selectStoryClips([
        {file:'old.mp4',tileIndex:4,got:true,prompt:story.scenes[0].script_line},
        {file:'new.mp4',tileIndex:0,got:true,prompt:story.scenes[0].script_line},
        {file:'end.mp4',tileIndex:2,got:true,prompt:story.scenes[1].script_line},
    ], story);
    assert.deepEqual(selection.selected.map(c=>c.file), ['new.mp4','end.mp4']);
    assert.deepEqual(selection.extras.map(c=>c.file), ['old.mp4']);
    assert.deepEqual(selectStoryClips([],story).missing,[1,2]);
    const withFailed = selectStoryClips([
        {file:'failed.mp4',tileIndex:0,got:true,caption:'Something went wrong',prompt:story.scenes[0].script_line},
        {file:'good.mp4',tileIndex:1,got:true,caption:'Traveller',prompt:story.scenes[0].script_line},
    ], {scenes:[story.scenes[0]]});
    assert.deepEqual(withFailed.selected.map(c=>c.file), ['good.mp4'],
        'a failed tile must never enter the scene manifest');
    const extraManifest = {expected:4, complete:true, clips:[
        ...[1,2,3,4].map(n=>({file:`scene-${n}.mp4`,matched_scene:n,match_cover:1,got:true})),
        {file:'extra.mp4',matched_scene:null,match_cover:null,got:true},
    ],alternateClips:[{file:'scene-3.mp4',caption:'metadata retained'}]};
    const fixed = resolveSceneManifest(extraManifest);
    assert.equal(fixed.clips.length,4);
    assert.deepEqual(fixed.alternateClips.map(c=>c.file),['extra.mp4']);
    assert.equal(fixed.clips[2].caption,'metadata retained');
    const missingScene = {...extraManifest,clips:extraManifest.clips.filter(c=>c.matched_scene!==2)};
    assert.equal(resolveSceneManifest(missingScene),missingScene,'must not discard extras if a scene is missing');
    const server = fs.readFileSync(path.join(__dirname, 'mcp_server.js'), 'utf8');
    assert.match(server, /pushOpt\(args, '--expected', expected\)/);
    const joiner = fs.readFileSync(path.join(__dirname, 'join_clips.js'), 'utf8');
    assert.match(joiner, /REFUSING TO JOIN: story expects/);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ expected: 2, clips: [
        { file: 'old.mp4', got: true },
    ] }));
    const blocked = spawnSync(process.execPath, [path.join(__dirname, 'join_clips.js'), dir], { encoding: 'utf8' });
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /REFUSING TO JOIN/);
    console.log('Agent downloader passed: virtualized video tiles, retry recovery, expected-count gate, join protection.');
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}
