// The compact Flow controls used ONLY for reference sheets. The film's video
// model still belongs to agent_mode.js and its generation-default settings.
const IMAGE_MODEL = 'Nano Banana Pro';
const IMAGE_RATIO = '16:9';
const ACTIVITY_WAIT_MS = 60000;
const ACTIVITY_RETRIES = 2;
const ACTIVITY_BLOCKED = 'UNUSUAL_ACTIVITY_BLOCKED';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs inside the page. Match the stable labels supplied by Flow, not Angular's
// numbered IDs. Ignore hidden copies and icon ligatures such as crop_16_9.
function compactControls(action) {
    const wantedRatio = typeof action === 'object' && action.ratio ? String(action.ratio) : IMAGE_RATIO;
    const activate=typeof action==='object' && action.activate;
    action=typeof action==='object'?action.action:action;
    const visible = el => {
        if (!el) return false;
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const text = el => {
        if (!el) return '';
        const copy = el.cloneNode(true);
        copy.querySelectorAll('mat-icon').forEach(i => i.remove());
        return (copy.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const key = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const radios = [...document.querySelectorAll('button[role="radio"]')].filter(visible);
    const label = el => text(el.querySelector('.toggle-text') || el);
    const image = radios.find(el => /^image$/i.test(label(el)));
    const panel = image && image.closest('.cdk-overlay-pane');
    const scope = panel || document;
    const ratio = [...scope.querySelectorAll('button[role="radio"]')]
        .find(el => visible(el) && label(el) === wantedRatio);
    const outputCountRadios = [...scope.querySelectorAll('flow-toggles[aria-label="Output count"] button[role="radio"]')]
        .filter(visible);
    const outputCountOne = outputCountRadios.find(el => label(el).toLowerCase() === 'x1');
    const selectedOutputCount = outputCountRadios.find(el => el.getAttribute('aria-checked') === 'true');
    const picker = [...scope.querySelectorAll('button[aria-label="Select model family"]')].find(visible);
    const summary = [...document.querySelectorAll('.settings-summary')].find(visible);
    if (action === 'state') return {
        image: !!image && image.getAttribute('aria-checked') === 'true',
        ratio: !!ratio && ratio.getAttribute('aria-checked') === 'true',
        model: text(picker),
        outputCount: selectedOutputCount ? label(selectedOutputCount).toLowerCase()
            : /(?:^|\s)x1(?:\s|$)/i.test(text(summary)) ? 'x1' : '',
        summary: text(summary),
        summaryLandscape: !!summary && [...summary.querySelectorAll('mat-icon')]
            .some(i => (i.textContent || '').trim() === 'crop_16_9'),
        summaryText: text(summary),
        open: !!image,
    };
    let target;
    if (action === 'open') target = summary && (summary.closest('button, [role="button"]') || summary);
    if (action === 'image') target = image;
    if (action === 'ratio') target = ratio;
    if (action === 'count') target = outputCountOne;
    if (action === 'model') target = picker;
    if (action === 'pro') {
        target = [...document.querySelectorAll('.cdk-overlay-pane span.label, [role="menuitem"], [role="option"]')]
            .find(el => visible(el) && !el.closest('button[aria-label="Select model family"]')
                && key(text(el)) === 'nanobananapro');
        if (target) target = target.closest('button, [role="menuitem"], [role="option"]') || target;
    }
    if (!visible(target) || target.disabled || target.getAttribute('aria-disabled') === 'true') return null;
    const r = target.getBoundingClientRect();
    if(activate)target.click();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

async function configureReferenceImages(page, say = () => {}, aspect = IMAGE_RATIO) {
 await require('./flow_composer_layout').normalize(page,say);
    const state = () => page.evaluate(compactControls, { action: 'state', ratio: aspect });
    const until = async (check, message) => {
        for (let n = 0; n < 40; n++) {
            if (await check()) return;
            await sleep(200);
        }
        throw new Error(`Reference image settings: ${message}. Nothing submitted.`);
    };
    const click = async action => {
        let point;
        await until(async () => !!(point = await page.evaluate(compactControls, {action,activate:true,ratio:aspect})), `cannot find ${action} control`);
    };
    // A fresh project's composer can remount just after Agent is turned off.
    // Re-open if that remount discarded the first click, before touching Image.
    if(!(await state()).open) {
        await click('open');
        await until(async () => (await state()).open, 'compact settings did not open after clicking the composer summary');
    }
    await click('image');
    await until(async () => (await state()).image, 'Image mode did not become selected');
    await click('ratio');
    await until(async () => (await state()).ratio, `${aspect} did not become selected`);
    if ((await state()).outputCount !== 'x1') {
        await click('count');
        await until(async () => (await state()).outputCount === 'x1', 'Output count did not become x1');
    }
    await click('model');
    await click('pro');
    await until(async () => {
        const s = await state();
        return s.image && s.ratio && s.outputCount === 'x1'
            && s.model.toLowerCase().replace(/[^a-z0-9]/g, '') === 'nanobananapro';
    }, `Image / ${aspect} / Nano Banana Pro / x1 could not be verified`);
    // This compact popover applies immediately; it has no full-drawer Save.
    // Escape closes the compact menu on the current Flow layout. Do not click
    // the summary again here: on some builds that immediately reopens the menu
    // and leaves the next prompt insertion behind its popover.
    await page.keyboard.press('Escape');
    await sleep(500);
    // On some Flow builds Escape updates the settings summary but leaves the
    // compact Image/ratio/model popover on screen. Require its controls to
    // disappear before pasting a prompt or clicking Start generation.
    for (let attempt = 0; attempt < 3 && (await state()).open; attempt++) {
        await page.keyboard.press('Escape');
        await sleep(350);
    }
    if ((await state()).open) {
        const point = await page.evaluate(() => {
            const box = document.querySelector('flow-base-prompt-box .ProseMirror, .ProseMirror, [contenteditable="true"]');
            if (!box) return null;
            const r = box.getBoundingClientRect();
            return r.width && r.height ? {x:Math.round(r.left+8),y:Math.round(r.bottom-12)} : null;
        });
        if (point) { await page.mouse.click(point.x, point.y); await sleep(350); }
    }
    await until(async () => !(await state()).open, 'compact settings popover stayed open over the prompt composer');
    await until(async () => {
        const s = await state();
        return s.outputCount === 'x1' && /nano\s+banana\s+pro/i.test(s.summary)
            && (aspect === '16:9' ? s.summaryLandscape : true);
    }, `settings summary did not confirm Nano Banana Pro, ${aspect} and x1`);
    say(`Reference settings verified: Image / ${aspect} / Nano Banana Pro / x1.`);
}

// A failed tile can have More options too. Count only completed image media,
// and remember existing assets/errors so a retry cannot rename an older tile.
function referenceState() {
    const visible = el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const memory = window.__veoReferenceWatch || (window.__veoReferenceWatch = { ids: new WeakMap(), next: 0 });
    const id = el => {
        if (!memory.ids.has(el)) memory.ids.set(el, String(++memory.next));
        return memory.ids.get(el);
    };
    const more = [...document.querySelectorAll('button[aria-label="More options"]')]
        .filter(b => !b.closest('.header-right-container, .header-desktop-main-row') && b.closest('[class*=hover-overlay]'));
    const images = [], videos = [];
    const tiles = [...document.querySelectorAll('flow-image-tile, flow-video-tile')];
    // Older builds use an unlabelled wrapper around the per-asset menu.
    if (!tiles.length) for (const b of more) {
        let root = b.closest('[class*=hover-overlay]');
        for (let n = 0; n < 6 && root && !root.querySelector('img, video'); n++) root = root.parentElement;
        if (root && !tiles.includes(root)) tiles.push(root);
    }
    for (const tile of tiles) {
        const button = tile.querySelector('button[aria-label="More options"]');
        if (tile.tagName.toLowerCase() === 'flow-video-tile' || tile.querySelector('video')) {
            videos.push(id(tile));
            continue;
        }
        const image = [...tile.querySelectorAll('img')].find(im => im.complete && im.naturalWidth > 0);
        if (image && button && !tile.querySelector('[role="progressbar"], [class*=error-tile]')) {
            images.push({ key: image.currentSrc || image.src || id(tile), tileIndex: more.indexOf(button) });
        }
    }
    const errors = [];
    for (const el of document.querySelectorAll('[class*=error-tile], [role="alert"], [role="dialog"], mat-dialog-container, .mat-mdc-snack-bar-container')) {
        if (!visible(el)) continue;
        const text = [el.innerText || '', ...[...el.querySelectorAll('[title], [aria-label]')]
            .map(n => n.getAttribute('title') || n.getAttribute('aria-label') || '')].join(' ').trim();
        if (/unusual\s+activity|failed|something went wrong|usage limit/i.test(text)) errors.push({ key: id(el) + ':' + text, text });
    }
    // Some builds render the message directly on the page rather than a card.
    // Count occurrences so an old warning is not mistaken for a new failure.
    const activityCount = ((document.body.innerText || '').match(/unusual\s+activity/gi) || []).length;
    const promptBox = document.querySelector('flow-base-prompt-box .ProseMirror, .ProseMirror, [contenteditable="true"]');
    const promptText = promptBox ? String(promptBox.innerText || promptBox.textContent || '').trim() : '';
    const submit = [...document.querySelectorAll('button[aria-label*="start generation" i]')].find(visible);
    return { images, videos, errors, activityCount, promptText,
        submitEnabled: !!submit && !submit.disabled && submit.getAttribute('aria-disabled') !== 'true',
        tileCount: more.length };
}

async function waitForReferenceSubmission(page, before, expectedPrompt, seconds = 15, opts = {}) {
    const pause = opts.sleep || sleep, now = opts.now || Date.now;
    const end = now() + seconds * 1000;
    const expected = String(expectedPrompt || '').trim();
    let last = before;
    while (now() < end) {
        last = await page.evaluate(referenceState);
        const newImage = last.images.find(x => !before.images.some(y => y.key === x.key));
        if (newImage || last.videos.length > before.videos.length || last.tileCount > before.tileCount)
            return {ok:true,evidence:'new Flow media tile',state:last};
        if (before.promptText && last.promptText !== before.promptText)
            return {ok:true,evidence:last.promptText ? 'composer prompt changed' : 'composer cleared',state:last};
        if (!last.submitEnabled && last.promptText !== expected)
            return {ok:true,evidence:'submit entered a disabled/generating state',state:last};
        await pause(Math.min(500, Math.max(0, end-now())));
    }
    last = await page.evaluate(referenceState);
    const noMediaChange = last.tileCount <= before.tileCount
        && last.images.length <= before.images.length && last.videos.length <= before.videos.length;
    const safeToRetry = !!expected && last.promptText === expected && noMediaChange && last.submitEnabled;
    return {ok:false,safeToRetry,state:last,
        why:safeToRetry
            ? `Flow did not accept the click: the same prompt is still in the composer and no new tile appeared after ${seconds}s.`
            : `Submission state was ambiguous after ${seconds}s; keeping the request pending to avoid duplicating it.`};
}

async function waitForReferenceImage(page, before, seconds, opts = {}) {
    const pause = opts.sleep || sleep;
    const now = opts.now || Date.now;
    const end = now() + seconds * 1000;
    const oldImages = new Set(before.images.map(x => x.key));
    const oldVideos = new Set(before.videos);
    const oldErrors = new Set(before.errors.map(x => x.key));
    let activityCount = before.activityCount;
    do {
        const state = await page.evaluate(referenceState);
        const errors = state.errors.filter(e => !oldErrors.has(e.key));
        const unusual = errors.find(e => /unusual\s+activity/i.test(e.text));
        if (unusual || state.activityCount > activityCount) return { ok: false, unusual: true, why: unusual ? unusual.text : 'We noticed unusual activity.' };
        // If a toast disappears then comes back with identical text, it is new.
        for (const key of oldErrors) if (!state.errors.some(e => e.key === key)) oldErrors.delete(key);
        activityCount = Math.min(activityCount, state.activityCount);
        if (errors.length) return { ok: false, why: errors[0].text };
        if (state.videos.some(k => !oldVideos.has(k))) return { ok: false, why: 'Flow created a video tile during reference image generation.' };
        const image = state.images.find(x => !oldImages.has(x.key) && x.tileIndex >= 0);
        if (image) return { ok: true, tileIndex: image.tileIndex };
        if (now() >= end) break;
        await pause(Math.min(3000, Math.max(0, end - now())));
    } while (now() <= end);
    return { ok: false, why: `No completed reference image after ${seconds}s.` };
}

// Google's guidance for this exact message is to wait a couple of minutes.
// Two retries, each after a full 60s pause; no account or browser switching.
async function withActivityWait(attempt, opts = {}) {
    const say = opts.log || (() => {}), pause = opts.sleep || sleep;
    const retries=process.env.VEO_ACTIVITY_COOLDOWN_ENABLED==='0'?0:Math.max(0,Math.min(3,Number(process.env.VEO_ACTIVITY_MAX_ATTEMPTS)||3)-1);
    const waitMs=Math.max(60,Number(process.env.VEO_ACTIVITY_WAIT_SECONDS)||60)*1000;
    for (let n = 0; n <= retries; n++) {
        const result = await attempt(n);
        if (result.ok || !result.unusual) return result;
        if (n === retries) {
            say(`${ACTIVITY_BLOCKED}: still blocked after ${retries} retries. Stopping generation; try manually later and check VPN/proxy settings or contact Flow support.`);
            return { ...result, blocked: true };
        }
        say(`WAIT MODE: Flow reported unusual activity. Retrying this reference in ${waitMs/1000} seconds (${n + 1}/${retries}).`);
        for (let remaining = waitMs; remaining > 0; remaining -= 30000) {
            await pause(Math.min(30000, remaining));
            if (remaining > 30000) say(`WAIT MODE: ${(remaining - 30000) / 1000} seconds remaining.`);
        }
    }
}

function referenceTimeoutMs(count, waitSeconds) {
    // Each sheet can take three complete attempts plus two cooldowns and UI
    // verification/renaming. The MCP process must not kill a legitimate wait.
    const retries=process.env.VEO_ACTIVITY_COOLDOWN_ENABLED==='0'?0:Math.max(0,Math.min(3,Number(process.env.VEO_ACTIVITY_MAX_ATTEMPTS)||3)-1);
    const waitMs=Math.max(60,Number(process.env.VEO_ACTIVITY_WAIT_SECONDS)||60)*1000;
    return 120000 + Math.max(1, count) * ((retries + 1) * (waitSeconds * 1000 + 60000) + retries * waitMs);
}

module.exports = {
    IMAGE_MODEL, IMAGE_RATIO, ACTIVITY_WAIT_MS, ACTIVITY_RETRIES, ACTIVITY_BLOCKED,
    compactControls, configureReferenceImages, referenceState, waitForReferenceSubmission, waitForReferenceImage,
    withActivityWait, referenceTimeoutMs,
};
