const { normalizeProjectUrl } = require('./flow_project');
const GR = require('./generate_refs');
const { createProject } = require('./project_setup');
const verifiedPages = new WeakMap();
async function waitForComposer(page) {
    try {
        await page.waitForFunction(() => {
            const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            const editor = [...document.querySelectorAll('.ProseMirror[contenteditable="true"], [contenteditable="true"]')].find(visible);
            const trigger = [...document.querySelectorAll('button[aria-label="Settings trigger"]')].find(visible);
            return !!editor && !!trigger && !trigger.disabled && trigger.getAttribute?.('aria-disabled') !== 'true';
        }, {timeout: 60000});
    } catch { throw Error('Omni composer did not become ready for the next prompt. No page reload or duplicate submission was attempted.'); }
}
function settingsSummary() {
    const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const trigger = [...document.querySelectorAll('button[aria-label="Settings trigger"]')].find(visible);
    return trigger ? (trigger.innerText || trigger.textContent || '').trim() : '';
}
function summaryMatches(summary, options) {
    const compact = s => String(s).replace(/\s+/g, '').toLowerCase();
    // Flow sometimes collapses this to "Video · 360p · 8s x1".
    // This check is only used after the same page/configuration was verified.
    if (!compact(summary).includes(compact(options.model)) && !/^video\s*[·•]/i.test(summary.trim())) return false;
    const resolution = summary.match(/\b(360p|720p)\b/i)?.[1];
    if (resolution && resolution.toLowerCase() !== options.resolution) return false;
    const aspect = summary.match(/(?:crop_|\b)(9[_:]16|16[_:]9|1[_:]1)(?:\b|$)/)?.[1]?.replace('_', ':');
    if (aspect && options.ratio !== 'Flow' && aspect !== options.ratio) return false;
    const count = summary.match(/\bx([1-4])\b/i)?.[1];
    return !count || count === '1';
}


async function prepareReferences(engine, deps = {}) {
    const generate = deps.generateRefs || GR.generateRefs;
    const create = deps.createProject || createProject;
    const log = deps.log || (() => {});
    if (engine.opts.newProject || engine.freshProject) {
        const created = await create(engine.browser, engine.page);
        engine.page = created.page;
        engine.projectUrl = created.url;
    } else {
        engine.projectUrl = normalizeProjectUrl(engine.projectUrl || engine.page.url());
    }
    // /tool, /scene and /edit are editors. Sheets must be made on project home.
    engine.projectUrl = normalizeProjectUrl(engine.projectUrl);
    await engine.page.goto(engine.projectUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await engine.waitForFlowShell();
    engine._projectPrepared = true;
    log(`project_url: ${engine.projectUrl}`);
    if (!engine.genRefs) return;
    if (!engine.storyRefs.length) throw Error('No reference prompts found in refs.json. No clips were submitted.');
    const result = await generate(engine.page, engine.storyRefs, { log, keepAgentOn: true,
        savedCouple: engine.savedCouple === undefined ? require('./saved_couple').loadSavedCouple('ingredients') : engine.savedCouple });
    if (result.blocked || result.failed || result.made !== engine.storyRefs.length) {
        throw Error(`Reference phase incomplete: ${result.made || 0}/${engine.storyRefs.length} made and renamed.`
            + (result.blocked ? ' Flow still reports unusual activity; retry after the restriction clears.' : '')
            + ' Clip generation stopped.');
    }
    engine._refsGenerated = true;
    log('Reference phase complete. Named image tiles are ready; Agent Mode remains off.');
}

// Compact generation selector used after returning from the reference phase.
function videoControl({ action, ratio }) {
    const visible = e => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
    const radios = [...document.querySelectorAll('button[role="radio"]')].filter(visible);
    const find = name => radios.find(e => (e.querySelector('.toggle-text')?.textContent || '').trim() === name);
    const video = find('Video');
    const aspect = find(ratio);
    if (action === 'verified') return video?.getAttribute('aria-checked') === 'true' && (ratio === 'Flow' || aspect?.getAttribute('aria-checked') === 'true');
    if (action === 'state') return { open: !!video, video: video?.getAttribute('aria-checked') === 'true',
        ratio: ratio === 'Flow' || aspect?.getAttribute('aria-checked') === 'true' };
    let el = action === 'open' ? [...document.querySelectorAll('.settings-summary')].find(visible)
        : action === 'video' ? video : aspect;
    if (!visible(el)) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

async function prepareVideo(page, { model = 'Omni 1.1 Flash', ratio = '9:16', resolution = '720p', log = () => {} } = {}) {
    if (!['Flow', '16:9', '9:16', '1:1'].includes(ratio)) throw Error('Unsupported Single Clip Omni aspect ratio: ' + ratio);
    if (!/Omni.*Flash/i.test(model)) throw Error('Single Clip Omni requires an Omni Flash model.');
    if (!['360p','720p'].includes(resolution)) throw Error('Select 360p or 720p resolution.');
    await waitForComposer(page);
    const options = {model, ratio, resolution};
    const key = JSON.stringify(options);
    const cached = verifiedPages.get(page);
    if (cached?.key === key && cached.url === page.url() && summaryMatches(await page.evaluate(settingsSummary), options)) {
        log(`Reusing verified Omni settings: ${model} / ${ratio} / ${resolution} / x1.`);
        return;
    }
    const off = await GR.setAgent(page, false);
    if (!off.ok) throw Error('Could not disable Agent Mode for Ingredients generation: ' + off.why);

    const visible = async (selector) => {
        const handles = await page.$$(selector);
        for (const h of handles) {
            const ok = await h.evaluate(e => {
                const r = e.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            }).catch(() => false);
            if (ok) return h;
        }
        return null;
    };

    // Puppeteer's ElementHandle.click() intermittently reports success on
    // Flow's animated Angular controls without Angular receiving the click.
    // That left the model menu closed and the following selector wait timed
    // out. A DOM click is the same path Flow itself uses and was verified on
    // the live compact settings panel.
    const domClick = async (handle, what) => {
        if (!handle) throw Error(`${what} was not found.`);
        const clicked = await handle.evaluate(e => {
            const r = e.getBoundingClientRect();
            if (!r.width || !r.height) return false;
            e.scrollIntoView({ block: 'center', inline: 'center' });
            e.click();
            return true;
        }).catch(() => false);
        if (!clicked) throw Error(`${what} was not visible or could not be clicked.`);
    };

    const openPanel = async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
            if (await visible('flow-prompt-box-settings')) return;
            if (attempt > 1) await page.keyboard.press('Escape');
            const trigger = await visible('button[aria-label="Settings trigger"]');
            if (!trigger) { await waitForComposer(page); continue; }
            // Real click on a fresh handle; settings can still be settling after submission.
            try { await trigger.click(); }
            catch { await domClick(trigger, 'Project settings summary button'); }
            try {
                await page.waitForSelector('flow-prompt-box-settings', {visible:true, timeout:4000});
                return;
            } catch { log(`Omni settings panel did not open on attempt ${attempt}/3; retrying in place.`); }
        }
        throw Error('Omni settings panel did not open after three attempts. No page reload or clip submission attempted.');
    };
    await openPanel();

    const clickRadio = async (label, required = true) => {
        const buttons = await page.$$('flow-prompt-box-settings button[role="radio"]');
        for (const h of buttons) {
            const state = await h.evaluate((e, wanted) => ({
                label: (e.querySelector('.toggle-text')?.textContent || '').trim(),
                checked: e.getAttribute('aria-checked') === 'true',
            }), label).catch(() => null);
            if (state && state.label === label) {
                if (!state.checked) {
                    await domClick(h, `Compact project setting "${label}"`);
                    await page.waitForFunction((wanted) => [...document.querySelectorAll(
                        'flow-prompt-box-settings button[role="radio"]')].some(b =>
                        (b.querySelector('.toggle-text')?.textContent || '').trim() === wanted &&
                        b.getAttribute('aria-checked') === 'true'), { timeout: 10000 }, label);
                }
                return true;
            }
        }
        if (required) throw Error(`Compact project setting "${label}" was not found.`);
        return false;
    };

    await clickRadio('Video');
    const hasIngredients = await clickRadio('Ingredients', false);
    if (ratio !== 'Flow') await clickRadio(ratio);
    await clickRadio('x1');

    if (model !== 'Flow') {
        let trigger = await visible('flow-prompt-box-settings button[aria-label="Select model family"]');
        if (!trigger) throw Error('Compact video model selector was not found.');
        const current = await trigger.evaluate(e => (e.innerText || '').replace(/arrow_drop_down/g, '').trim());
        if (current !== model) {
            await domClick(trigger, 'Compact video model selector');
            await page.waitForFunction((wanted) => [...document.querySelectorAll(
                '.cdk-overlay-pane [role="menuitem"]')].some(e => {
                const r = e.getBoundingClientRect();
                const label = (e.querySelector('.label')?.textContent || e.innerText || '').replace(/volume_up/g, '').trim();
                return r.width > 0 && r.height > 0 && label === wanted;
            }), { timeout: 15000 }, model);
            const items = await page.$$('.cdk-overlay-pane [role="menuitem"]');
            let chosen = null;
            for (const h of items) {
                const item = await h.evaluate(e => {
                    const r = e.getBoundingClientRect();
                    return {
                        visible: r.width > 0 && r.height > 0,
                        text: (e.querySelector('.label')?.textContent || e.innerText || '')
                            .replace(/volume_up/g, '').trim(),
                    };
                }).catch(() => null);
                if (item?.visible && item.text === model) { chosen = h; break; }
            }
            if (!chosen) throw Error(`Video model "${model}" is not available in the compact project selector.`);
            await domClick(chosen, `Video model "${model}"`);
            await page.waitForFunction((wanted) => {
                const trigger = document.querySelector('flow-prompt-box-settings button[aria-label="Select model family"]');
                const summary = document.querySelector('button[aria-label="Settings trigger"]');
                return (!!trigger && (trigger.innerText || '').replace(/arrow_drop_down/g, '').trim() === wanted)
                    || !!summary && (summary.innerText || '').includes(wanted);
            }, { timeout: 10000 }, model);
        }
    }

    // Choosing a model closes both the menu and, in the current build, the
    // compact settings panel. Reopen it so every choice can be read back.
    await openPanel();

    await clickRadio('Ingredients', false);
    await clickRadio(resolution);
    if (ratio !== 'Flow') await clickRadio(ratio);
    await clickRadio('x1');

    const verified = await page.evaluate(({ model, ratio, resolution, hasIngredients }) => {
        const root = document.querySelector('flow-prompt-box-settings');
        if (!root) return { ok: false, why: 'settings panel closed before verification' };
        const radios = [...root.querySelectorAll('button[role="radio"]')];
        const checked = name => radios.some(b =>
            (b.querySelector('.toggle-text')?.textContent || '').trim() === name &&
            b.getAttribute('aria-checked') === 'true');
        const trigger = root.querySelector('button[aria-label="Select model family"]');
        const modelText = (trigger?.innerText || '').replace(/arrow_drop_down/g, '').trim();
        const ok = checked('Video') && (!hasIngredients || checked('Ingredients')) && checked(resolution) && checked('x1') &&
            (ratio === 'Flow' || checked(ratio)) && (model === 'Flow' || modelText === model);
        return { ok, model: modelText, video: checked('Video'), ingredients: checked('Ingredients'),
            ratio: ratio === 'Flow' || checked(ratio), resolution, x1: checked('x1') };
    }, { model, ratio, resolution, hasIngredients });
    if (!verified.ok) throw Error('Single Clip Omni video settings did not verify: ' + JSON.stringify(verified));
    await page.keyboard.press('Escape');
    verifiedPages.set(page, {key, url:page.url()});
    log(`Single Clip Omni settings verified: Video / Ingredients / ${verified.model} / ${ratio} / ${resolution} / x1; Agent Mode off.`);
    log('Standalone video generation: no Extend. References are attached to every clip.');
}

module.exports = { prepareReferences, prepareVideo, videoControl, waitForComposer, summaryMatches };
