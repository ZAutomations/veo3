const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { hasVideoContainer, playableVideo } = require('./download_media_validation');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-media-validation-'));
try {
    const login = path.join(dir, 'login.mp4');
    fs.writeFileSync(login, '<!doctype html><html>Google sign-in</html>'.repeat(40000));
    assert.equal(hasVideoContainer(fs.readFileSync(login)), false);
    assert.equal(playableVideo(login).ok, false);
    const real = path.join(dir, 'real.mp4');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i',
        'color=c=blue:s=128x72:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', real], {windowsHide:true});
    assert.equal(hasVideoContainer(fs.readFileSync(real)), true);
    assert.equal(playableVideo(real).ok, true);
    const broken = path.join(dir, 'broken.mp4');
    fs.writeFileSync(broken, fs.readFileSync(real).subarray(0, 50));
    assert.equal(playableVideo(broken).ok, false);
    console.log('Media validation passed: large login HTML rejected, real video decoded, truncated video rejected.');
} finally { fs.rmSync(dir, {recursive:true,force:true}); }
