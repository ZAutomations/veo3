const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'partial-omni-join-'));
try {
    const clip = 'scene-01.mp4';
    const ledger = 'omni_manifest.partial.json';
    const contents = JSON.stringify({ expected: 2, complete: false,
        clips: [{ file: clip, matched_scene: 1, got: true }] });
    fs.writeFileSync(path.join(folder, clip), '');
    fs.writeFileSync(path.join(folder, ledger), contents);
    const joiner = path.join(__dirname, '..', 'join_clips.js');
    for (const flags of [[], ['--dry-run'], ['--order', clip]]) {
        const result = spawnSync(process.execPath, [joiner, folder, ...flags], { encoding: 'utf8' });
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /RECOVERY_REVIEW_REQUIRED: Only a partial Omni download ledger/);
    }
    assert.deepEqual(fs.readdirSync(folder).sort(), [ledger, clip]);
    assert.equal(fs.readFileSync(path.join(folder, ledger), 'utf8'), contents);
} finally {
    for (const file of fs.readdirSync(folder)) fs.unlinkSync(path.join(folder, file));
    fs.rmdirSync(folder);
}
