const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ids = require('../agent_scene_ids');
const receipts = require('../agent_source_receipts');
const { needsInventoryRefresh } = require('../agent_upscaled_download');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-agent-inventory-'));
try {
    const project = 'https://flow.google.com/project/test-project';
    const story = { title: 'Test', scenes: [{}, {}, {}] };
    const storyFile = path.join(folder, 'story.json');
    fs.writeFileSync(storyFile, JSON.stringify(story));
    const audited = story.scenes.map((_, i) => ({
        scene: i + 1,
        assetId: `audited-${i + 1}`,
        duration: 10,
    }));
    receipts.save(storyFile, project, audited);
    const fresh = audited.map(row => ({
        assetId: row.assetId,
        assetTitle: ids.sceneId(story, row.scene),
        ready: true,
    }));
    const stale = [...fresh.slice(0, 2), { assetId: 'stale-3', ready: true }];

    assert.equal(needsInventoryRefresh(storyFile,project,[{assetId:'rotated-unknown',ready:true}],story),true);
    assert.equal(needsInventoryRefresh(storyFile,project,[{assetId:'rotated-unknown',ready:true,busy:true}],story),false);
    assert.equal(receipts.plan(storyFile, project, stale), null);
    assert.equal(needsInventoryRefresh(storyFile, project, stale, story), true);
    assert.equal(needsInventoryRefresh(storyFile, project, fresh, story), false);
    assert.deepEqual(ids.plan(fresh, story).map(entry => entry.receipt.assetId), audited.map(row => row.assetId));
    assert.equal(needsInventoryRefresh(storyFile, project, [fresh[0], fresh[1], { ...fresh[2], assetTitle: fresh[1].assetTitle }], story), false);
    assert.equal(needsInventoryRefresh(storyFile, project, [{ ...fresh[0], assetTitle: '' }], story), true);
    assert.equal(needsInventoryRefresh(storyFile, project, [...fresh.slice(0, 2), { ...fresh[2], assetTitle: '' }], story), false);
} finally {
    fs.rmSync(folder, { recursive: true, force: true });
}
