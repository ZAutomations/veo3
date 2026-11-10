'use strict';
const RI = require('./reference_image_step');
const grid = require('./flow_grid_scroll');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const key = value => String(value || '').trim().toLowerCase();
// Signed expiry/signature and thumbnail-size parameters are not asset identities.
// Normalize only known Flow image routes; never collapse arbitrary query-based URLs.
function imageIdentity(value) {
 const raw=String(value||'');
 try {
  const url=new URL(raw);
  if(url.hostname==='flow-content.google'&&/^\/image\/[a-f0-9-]{36}$/i.test(url.pathname))return 'flow-image:'+url.pathname.split('/').pop().toLowerCase();
  if(url.hostname==='flow.google.com'&&url.pathname.startsWith('/asb/'))return url.origin+url.pathname.replace(/=s\d+(?:-[a-z]+)*$/i,'');
 }catch{}
 return raw;
}
function fileLabel(value) {
    return key(value).replace(/^(?:(?:favorite|favourite|redo|undo|more_vert))+(?:image)?/i, '')
        .replace(/\.(?:png|jpe?g|webp|avif)$/i, '')
        .replace(/\s*\(\d+\)$/, '').replace(/[\s_-]+/g, ' ').trim();
}
function matchesName(image, ref) {
    let label = fileLabel(image.name);
    const name = fileLabel(ref.name);
    // Recognize this observed transposition only for the Environment role.
    // Never fuzzy-match human names or turn a different reference into it.
    if (name === 'environment') label = label.replace(/^enviornment(?=$| )/, 'environment');
    return !!name && (label === name || label === name + ' reference' || label === name + ' ref');
}
function thumbnailName(image) { return /\b(?:thumbnail|thumb|end[ _-]*card|cover)\b/i.test(fileLabel(image.name)); }
function chooseImage(images, refs, refIndex, pending) {
    const ref = refs[refIndex], exact = images.filter(im => key(im.name) === key(ref.name));
    // Multiple correctly named images need no mutation: downstream mentions
    // can still use the exact name. Never rename one as another reference.
    if (exact.length) return { image: exact[0], alreadyNamed: true, evidence: 'exact name' };
    const unclaimed = images.filter(im => !refs.some(r => key(im.name) === key(r.name)));
    const unique = (list, evidence) => list.length === 1 ? { image: list[0], evidence } : null;
    const aliases = unclaimed.filter(im => matchesName(im, ref)
        && refs.filter(r => matchesName(im, r)).length === 1);
    if (aliases.length) return unique(aliases, 'reference filename/name') || { ambiguous: aliases };
    const candidates = unclaimed.filter(im => !refs.some(r => key(r.name) !== key(ref.name) && matchesName(im, r))
        && (ref.kind === 'thumbnail' || !thumbnailName(im)));
    const recorded = candidates.filter(im => pending?.imageKey && imageIdentity(im.key) === imageIdentity(pending.imageKey));
    if (recorded.length) return unique(recorded, 'saved project asset') || { ambiguous: recorded };
    const promptMatches = candidates.filter(im => im.prompt && key(im.prompt) === key(ref.prompt));
    if (promptMatches.length) return unique(promptMatches, 'exact source prompt') || { ambiguous: promptMatches };
    if (ref.kind === 'thumbnail') {
        const named = candidates.filter(thumbnailName);
        if (named.length) return unique(named, 'thumbnail name') || { ambiguous: named };
    }
    const missing = refs.filter(r => !images.some(im => key(im.name) === key(r.name)));
    // A new manual upload may have only its filename. Use its aspect ONLY
    // after a saved request baseline, only when that role has a unique aspect,
    // and only in a small reference-only inventory. This does not infer content
    // from an arbitrary old photo elsewhere in a populated project.
    if (pending?.before && Array.isArray(pending.before.images) && images.length <= refs.length) {
        const aspect = String(ref.aspect || '16:9');
        const sameAspect = missing.filter(r => String(r.aspect || '16:9') === aspect);
        if (sameAspect.length === 1) {
            const [w, h] = aspect.split(':').map(Number), old = new Set(pending.before.images.map(im => imageIdentity(im.key)));
            const added = candidates.filter(im => !old.has(imageIdentity(im.key)) && im.width > 0 && im.height > 0
                && Math.abs(im.width / im.height - w / h) < 0.035);
            if (added.length) return unique(added, 'unique new reference aspect after saved request') || { ambiguous: added };
        }
    }
    if (pending && missing.length === 1 && key(missing[0].name) === key(ref.name)
        && unclaimed.length === 1 && images.length === refs.length && candidates.length === 1)
        return { image: candidates[0], evidence: 'only remaining reference after all other names verified' };
    if (candidates.length && pending) return { ambiguous: candidates };
    return null;
}

// Read the whole reference grid once per preparation run. Do not use a DOM
// position as an asset identity: virtualization can remount/reorder the tiles.
async function scanImages(page, readName, log = () => {}, opts = {}) {
    const pause = opts.sleep || sleep, records = new Map();
    await page.evaluate(grid.installGridScroller);
    const initial = await page.evaluate(grid.gridMetrics);
    await page.evaluate(grid.scrollGrid, 0);
    await pause(200);
    let complete = false;
    for (let round = 0; round < 120; round++) {
        const state = await page.evaluate(RI.referenceState);
        const position = await page.evaluate(grid.gridMetrics);
        for (const image of state.images.filter(im => im.tileIndex >= 0)) {
            const name = await readName(page, image.tileIndex);
            records.set(imageIdentity(image.key), { ...image, name: String(name || '').trim(), scrollTop: position.top });
        }
        const end = position.mediaEnd ?? position.scroll;
        if (position.mediaCovered || position.top >= end - position.client - 2) { complete = true; break; }
        const target = Math.min(Math.max(0, end - position.client), position.top + Math.max(120, position.client * 0.72));
        if (target <= position.top + 2) break;
        await page.evaluate(grid.scrollGrid, target);
        await pause(300);
        const after = await page.evaluate(grid.gridMetrics);
        if (after.top <= position.top + 2) break;
    }
    await page.evaluate(grid.scrollGrid, initial.top);
    await pause(150);
    log(`Reference recovery audit: ${records.size} completed image(s); full grid=${complete}.`);
    return { images: [...records.values()], complete };
}
async function reconcile(page, refs, refIndex, receipt, inventory, readName, rename, log = () => {}, opts = {}) {
    const decision = chooseImage(inventory.images, refs, refIndex, receipt?.read());
    const ref = refs[refIndex];
    if (!decision) {
        if (!inventory.complete) return { ok: false, why: 'RECOVERY_REVIEW_REQUIRED: Reference grid scan was incomplete; no duplicate image request submitted.' };
        return null;
    }
    if (decision.ambiguous) return { ok: false, why: `RECOVERY_REVIEW_REQUIRED: Cannot uniquely identify ${ref.name} among existing images (${decision.ambiguous.map(im => im.name || 'unnamed').join(', ')}). Rename the intended tile exactly "${ref.name}" and retry; no image generated or renamed.` };
    const candidate = decision.image;
    await page.evaluate(grid.scrollGrid, candidate.scrollTop || 0);
    await (opts.sleep || sleep)(200);
    const current = await page.evaluate(RI.referenceState);
    const live = current.images.find(im => imageIdentity(im.key) === imageIdentity(candidate.key) && im.tileIndex >= 0);
    if (!live) return { ok: false, why: `RECOVERY_REVIEW_REQUIRED: Existing ${ref.name} image could not be relocated by asset identity. No duplicate submitted.` };
    const label = String(await readName(page, live.tileIndex) || '').trim();
    if (refs.some(r => key(r.name) !== key(ref.name) && key(r.name) === key(label)))
        return { ok: false, why: `RECOVERY_REVIEW_REQUIRED: Existing image is now named "${label}" for another required reference. No rename or generation performed.` };
    if (key(label) !== key(ref.name)) {
        log(`  Reusing existing image "${label || 'unnamed'}" as ${ref.name} (${decision.evidence}); renaming, not regenerating.`);
        const result = await rename(page, ref.name, live.tileIndex);
        if (!result.ok) return { ok: false, why: `Existing ${ref.name} image rename failed: ${result.why}` };
        let verified = false;
        for (let n = 0; n < 8; n++) {
            const audit = await page.evaluate(RI.referenceState);
            const same = audit.images.find(im => imageIdentity(im.key) === imageIdentity(live.key) && im.tileIndex >= 0);
            if (same && key(await readName(page, same.tileIndex)) === key(ref.name)) { verified = true; break; }
            await (opts.sleep || sleep)(250);
        }
        if (!verified) return { ok: false, why: `Existing ${ref.name} image rename is not yet visible on its own tile. No duplicate generated; retry will check it again.` };
    }
    candidate.name = ref.name;
    receipt?.write({ status: 'completed', imageKey: live.key, recoveredExisting: true });
    log(`  Verified existing completed image "${ref.name}"; stale failed request skipped.`);
    return { ok: true, imageKey: live.key, tileIndex: live.tileIndex, alreadyNamed: true };
}
async function auditExisting(page, refs, refIndex, receipt, readName, rename, log, opts = {}) {
    const inventory = await scanImages(page, readName, log, opts);
    return reconcile(page, refs, refIndex, receipt, inventory, readName, rename, log, opts);
}
module.exports = { imageIdentity, matchesName, chooseImage, scanImages, reconcile, auditExisting };
