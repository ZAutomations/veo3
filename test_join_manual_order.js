const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-manual-join-'));
try {
    const first = path.join(dir,'scene-01.mp4');
    execFileSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=blue:s=128x72:d=1',
        '-c:v','libx264','-pix_fmt','yuv420p',first],{windowsHide:true});
    fs.copyFileSync(first,path.join(dir,'scene-02.mp4'));
    const manifest = {expected:2,complete:false,clips:[{file:'old-01.mp4',got:true},{file:'old-02.mp4',got:true}]};
    const mf = path.join(dir,'manifest.json');
    fs.writeFileSync(mf,JSON.stringify(manifest));
    const run = args => spawnSync(process.execPath,[path.join(__dirname,'join_clips.js'),dir,...args],{encoding:'utf8'});
    assert.equal(run(['--dry-run']).status,2);
    let r = run(['--order','scene-01,scene-02','--dry-run']);
    assert.equal(r.status,0,r.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(mf)),manifest,'dry run preserves original manifest');
    assert.equal(run(['--order','scene-01,missing','--dry-run']).status,2);
    assert.equal(run(['--order','scene-01,scene-01','--dry-run']).status,2);
    r=run(['--order','scene-01,scene-02']);
    assert.equal(r.status,0,r.stderr);
    const saved=JSON.parse(fs.readFileSync(mf));
    assert.equal(saved.complete,true);
    assert.equal(saved.orderResolvedBy,'manual');
    assert.deepEqual(saved.clips.map(c=>c.file),['scene-01.mp4','scene-02.mp4']);
    assert.equal(run(['--dry-run']).status,0,'subsequent ordinary join uses repaired manifest');
    fs.writeFileSync(mf,JSON.stringify({...saved, expected:3, complete:false}));
    assert.equal(run(['--order','scene-01,scene-02','--dry-run']).status,2,'a missing scene stays blocked unless partial export is explicit');
    r=run(['--allow-partial','--order','scene-01,scene-02','--out',path.join(dir,'test_partial.mp4')]);
    assert.equal(r.status,0,r.stderr);
    const partial=JSON.parse(fs.readFileSync(mf));
    assert.equal(partial.expected,3,'partial export does not lower the story scene count');
    assert.equal(partial.complete,false,'partial export never claims the full story is complete');
    assert(fs.existsSync(path.join(dir,'test_partial.mp4')));
    console.log('Manual join passed: stale manifest repaired only with explicit order, invalid orders refused, manifest backup and future join work.');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
