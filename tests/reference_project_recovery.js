'use strict';
const assert = require('assert');
const R = require('../reference_project_recovery');
const RI = require('../reference_image_step');
const grid = require('../flow_grid_scroll');
const refs = [{ name: 'Environment', prompt: 'Actual brain model', kind: 'place' },
    { name: 'Thumbnail', prompt: 'Portrait health poster', kind: 'thumbnail', aspect: '9:16' }];
const pending = { status: 'pending', before: { images: [] } };
const env = { key: 'manual-env', name: 'Environment.png', tileIndex: 0, width: 1600, height: 900 };
const thumb = { key: 'manual-thumb', name: 'cover.png', tileIndex: 1, width: 900, height: 1600 };
assert.equal(R.chooseImage([{ ...env, name: 'favoriteredomore_vertimageEnviornment', width: 0, height: 0 }], refs, 0, pending).image.key, env.key,
    'observed misspelled manual Environment with fused icon labels is recovered even when Thumbnail is not made yet');
assert(!R.matchesName({ name: 'Sammy' }, { name: 'SAM' }), 'no fuzzy character identity matching');
assert.equal(R.chooseImage([env, thumb], refs, 0, pending).image.key, env.key);
assert.equal(R.chooseImage([env, thumb], refs, 1, pending).image.key, thumb.key);
assert.equal(R.chooseImage([{ ...env, name: 'image1.png' }, { ...thumb, name: 'image2.png' }], refs, 0, pending).image.key, env.key);
assert.equal(R.chooseImage([{ ...env, name: 'image1.png' }, { ...thumb, name: 'image2.png' }], refs, 1, pending).image.key, thumb.key);
assert(R.chooseImage([{ ...env, name: 'image1.png' }, { ...thumb, name: 'image2.png', width: 1600, height: 900 }], refs, 0, pending).ambiguous);
assert.equal(R.chooseImage([{ ...thumb, name: 'Thumbnail' }], refs, 0, pending), null, 'thumbnail must not become environment');
assert.equal(R.chooseImage([{ ...env, name: 'random existing photo' }], refs, 0, null), null, 'no adoption of arbitrary old photo without a request');
assert(R.chooseImage([{ ...env, name: 'image1' }, { ...thumb, name: 'image2' }, { ...env, key: 'extra', name: 'extra' }], refs, 0, pending).ambiguous);
assert.equal(R.chooseImage([{ ...env, name: 'Environment' }, { ...thumb, name: 'manual.png' }], refs, 1, pending).image.key, thumb.key);
assert.equal(R.chooseImage([{ ...env, name: 'manual.png', prompt: refs[0].prompt }], refs, 0, null).evidence, 'exact source prompt');

(async () => {
    let position = 0, renamed = [], record = pending;
    // Two virtualized pages: older thumbnail is not mounted at the first view.
    const views = [[{ ...env, name: 'Environment.png', tileIndex: 3 }], [{ ...thumb, tileIndex: 0 }]];
    const page = { evaluate: async (fn, arg) => {
        if (fn === grid.installGridScroller) return;
        if (fn === grid.scrollGrid) { position = arg; return; }
        if (fn === grid.gridMetrics) return { top: position, client: 100, scroll: 200 };
        if (fn === RI.referenceState) return { images: views[position >= 100 ? 1 : 0], errors: [], videos: [], activityCount: 0 };
        throw Error('Unexpected page evaluation');
    } };
    const readName = async (_, index) => views[position >= 100 ? 1 : 0].find(im => im.tileIndex === index)?.name;
    const inventory = await R.scanImages(page, readName, () => {}, { sleep: async () => {} });
    assert(inventory.complete); assert.equal(inventory.images.length, 2);
    assert.equal(position, 0, 'scan restores original position');
    const receipt = { read: () => record, write: value => { record = value; } };
    const rename = async (_, name, index) => {
        const im = views[position >= 100 ? 1 : 0].find(im => im.tileIndex === index);
        renamed.push([im.key, name]); im.name = name;
        return { ok: true };
    };
    assert((await R.reconcile(page, refs, 0, receipt, inventory, readName, rename, () => {}, { sleep: async () => {} })).ok);
    assert.equal(record.status, 'completed'); assert.equal(record.imageKey, env.key);
    // A stale failed receipt must not block a manual thumbnail on an older page.
    record = pending;
    assert((await R.reconcile(page, refs, 1, receipt, inventory, readName, rename, () => {}, { sleep: async () => {} })).ok);
    assert.deepStrictEqual(renamed, [[env.key, 'Environment'], [thumb.key, 'Thumbnail']]);
    assert.equal(record.imageKey, thumb.key);
    // Repeating retry leaves verified names untouched.
    assert((await R.reconcile(page, refs, 1, receipt, inventory, readName, rename, () => {}, { sleep: async () => {} })).ok);
    assert.equal(renamed.length, 2);
    const missingPage = { evaluate: async fn => fn === RI.referenceState ? { images: [] } : undefined };
    assert(!(await R.reconcile(missingPage, refs, 1, receipt, inventory, readName, rename, () => {}, { sleep: async () => {} })).ok);
    // New completed manual image beats a still-visible failed generation card.
    const latePage = { evaluate: async () => ({ images: [env], videos: [], errors: [{ key: 'old-error-remounted', text: 'We noticed unusual activity.' }], activityCount: 1 }) };
    const result = await RI.waitForReferenceImage(latePage, { images: [], videos: [], errors: [], activityCount: 0 }, 1);
    assert(result.ok); assert.equal(result.tileIndex, env.tileIndex);
    const fs = require('fs'), source = fs.readFileSync(require.resolve('../generate_refs'), 'utf8');
    assert(source.indexOf('const existing = await auditExisting()') < source.indexOf('recovery.recoverPending'));
    const fresh = source.slice(source.indexOf('const generateFresh ='));
    assert(fresh.indexOf('const replacement = await auditExisting()') < fresh.indexOf('await prepare('));
    assert(fresh.indexOf('const beforeSubmitReplacement = await auditExisting()') < fresh.indexOf('receipt.write({status:'));
    // Reproduce this log's specific race: a failed thumbnail request, then a
    // manual 46_THUMBNAIL.png upload while the internal cooldown is sleeping.
    let assets = [{ ...env, name: 'Environment' }], submits = 0, adopted = pending;
    const retryPage = { evaluate: async (fn) => {
        if (fn === RI.referenceState) return { images: assets, errors: [], videos: [], activityCount: 0 };
        if (fn === grid.gridMetrics) return { top: 0, client: 100, scroll: 100 };
    } };
    const retryReceipt = { read: () => adopted, write: value => { adopted = value; } };
    const readRetry = async (_, index) => assets.find(im => im.tileIndex === index)?.name;
    const renameRetry = async (_, name, index) => { assets.find(im => im.tileIndex === index).name = name; return { ok: true }; };
    const previous = process.env.VEO_ACTIVITY_COOLDOWN_ENABLED;
    process.env.VEO_ACTIVITY_COOLDOWN_ENABLED = '1';
    try {
        const resumed = await RI.withActivityWait(async () => {
            const existing = await R.auditExisting(retryPage, refs, 1, retryReceipt, readRetry, renameRetry, () => {}, { sleep: async () => {} });
            if (existing) return existing;
            submits++;
            return { ok: false, unusual: true, why: 'Unusual activity' };
        }, { sleep: async () => { assets = [{ ...env, name: 'Environment' }, { ...thumb, name: '46_THUMBNAIL.png' }]; } });
        assert(resumed.ok); assert(resumed.alreadyNamed); assert.equal(resumed.tileIndex, 1);
        assert.equal(submits, 1, 'manual upload during cooldown must prevent the second submission');
        assert.equal(assets[1].name, 'Thumbnail');
    } finally {
        if (previous === undefined) delete process.env.VEO_ACTIVITY_COOLDOWN_ENABLED;
        else process.env.VEO_ACTIVITY_COOLDOWN_ENABLED = previous;
    }
    // Exercise real image loading, names, image-only menus and container scroll
    // in a headless local fixture, without touching the user's Flow session.
    const browser = await require('puppeteer').launch({ headless: true });
    try {
        const real = await browser.newPage();
        const svg = (w, h) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="orange"/></svg>`);
        await real.setContent(`<style>flow-image-tile {display:block;height:140px} img {width:90px;height:70px}</style><div style="height:170px;overflow-y:auto">
          <flow-image-tile><div class="hover-overlay"><img src="${svg(1600, 900)}"><span class="asset-title">Environment.png</span><button aria-label="More options">Menu</button></div></flow-image-tile>
          <flow-image-tile><div class="hover-overlay"><img src="${svg(900, 1600)}"><span class="asset-title">cover.png</span><button aria-label="More options">Menu</button></div></flow-image-tile></div>
          <div class="error-tile">Failed. We noticed unusual activity.</div>`);
        await real.waitForFunction(() => [...document.querySelectorAll('img')].every(im => im.complete && im.naturalWidth));
        const readRealName = require('../generate_refs').tileName;
        const full = await R.scanImages(real, readRealName);
        assert(full.complete); assert.equal(full.images.length, 2);
        assert.equal(full.images.find(im => im.name === 'cover.png').height, 1600);
        let realReceipt = pending;
        const store = { read: () => realReceipt, write: x => { realReceipt = x; } };
        let realRenames = 0;
        const renameReal = async (p, name, index) => {
            realRenames++;
            await p.evaluate(({ name, index }) => {
                document.querySelectorAll('flow-image-tile')[index].querySelector('.asset-title').textContent = name;
            }, { name, index });
            return { ok: true };
        };
        for (let i = 0; i < refs.length; i++)
            assert((await R.reconcile(real, refs, i, store, full, readRealName, renameReal)).ok);
        assert.equal(realRenames, 2);
        assert.deepStrictEqual(await real.evaluate(() => [...document.querySelectorAll('.asset-title')].map(el => el.textContent)), ['Environment', 'Thumbnail']);
        // Actual failing Flow layout: no .asset-title, icon nodes fused with a
        // misspelled label. Exercise the real tile-name reader and recovery.
        await real.setContent(`<flow-image-tile><img src="${svg(1600, 900)}"><div class="hover-overlay"><button><mat-icon>favorite</mat-icon></button><button><mat-icon>redo</mat-icon></button><button aria-label="More options"><mat-icon>more_vert</mat-icon></button></div><div class="footer-overlay"><flow-tile-hover-footer><button class="footer-left" aria-label="Enviornment"><mat-icon>image</mat-icon><span class="footer-title">Enviornment</span></button></flow-tile-hover-footer></div></flow-image-tile>`);
        await real.waitForFunction(() => document.querySelector('img').complete && document.querySelector('img').naturalWidth);
        assert.equal(await readRealName(real, 0), 'Enviornment', 'icon nodes must not be part of the asset name');
        const typoInventory = await R.scanImages(real, readRealName);
        assert.equal(R.chooseImage(typoInventory.images, refs, 0, pending).image.name, 'Enviornment');
        let corrected = false;
        const typoReceipt = { read: () => pending, write: x => { assert.equal(x.status, 'completed'); } };
        assert((await R.reconcile(real, refs, 0, typoReceipt, typoInventory, readRealName, async (p, name) => {
            assert.equal(name, 'Environment'); corrected = true;
            await p.evaluate(() => { document.querySelector('flow-image-tile span').textContent = 'Environment'; });
            return { ok: true };
        })).ok);
        assert(corrected);
    } finally { await browser.close(); }
    console.log('PASS: full-grid manual image recovery, role/filename/aspect identity, stale error bypass only after completion, rename once, ambiguous/missing assets preserved. No Flow or generation calls.');
})().catch(error => { console.error(error); process.exitCode = 1; });
