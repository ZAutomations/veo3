const { normalizeProjectUrl } = require('./flow_project');
const GR = require('./generate_refs');
const { createProject } = require('./project_setup');

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

async function prepareVideo(page, { model = 'Flow', ratio = 'Flow', log = () => {} } = {}) {
    if (!['Flow', '16:9', '9:16', '1:1'].includes(ratio)) throw Error('Unsupported Ingredients video ratio: ' + ratio);
    // This engine creates clip 1 with Ingredients and scenes 2+ with Extend.
    // Flow currently supports that chain only when the first clip is a Veo 3.1
    // Lite/Fast generation. Quality has no Ingredients support and Gemini Omni
    // cannot be extended yet.
    if (model !== 'Flow' && !/^Veo 3\.1 - (?:Lite|Fast)(?:\s|$)/i.test(model)) {
        throw Error(`Video model "${model}" is incompatible with the Ingredients + Extend pipeline. Use Veo 3.1 - Lite or Veo 3.1 - Fast.`);
    }
    // Ingredients generation runs with Agent Mode off. Configure the compact
    // project prompt settings directly: Video -> Ingredients -> ratio -> model.
    // These are the controls beside the project prompt, and they are separate
    // from the similarly named Agent settings window.
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

    let panel = await visible('flow-prompt-box-settings');
    if (!panel) {
        const trigger = await visible('button[aria-label="Settings trigger"]');
        if (!trigger) throw Error('Project settings summary button was not found.');
        await domClick(trigger, 'Project settings summary button');
        await page.waitForSelector('flow-prompt-box-settings', { visible: true, timeout: 15000 });
    }

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
    await clickRadio('Ingredients');
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
                return !!trigger && (trigger.innerText || '').replace(/arrow_drop_down/g, '').trim() === wanted;
            }, { timeout: 10000 }, model);
        }
    }

    // Choosing a model closes both the menu and, in the current build, the
    // compact settings panel. Reopen it so every choice can be read back.
    if (!await visible('flow-prompt-box-settings')) {
        const trigger = await visible('button[aria-label="Settings trigger"]');
        if (!trigger) throw Error('Settings summary disappeared after model selection.');
        await domClick(trigger, 'Project settings summary button');
        await page.waitForSelector('flow-prompt-box-settings', { visible: true, timeout: 10000 });
    }

    const verified = await page.evaluate(({ model, ratio }) => {
        const root = document.querySelector('flow-prompt-box-settings');
        if (!root) return { ok: false, why: 'settings panel closed before verification' };
        const radios = [...root.querySelectorAll('button[role="radio"]')];
        const checked = name => radios.some(b =>
            (b.querySelector('.toggle-text')?.textContent || '').trim() === name &&
            b.getAttribute('aria-checked') === 'true');
        const trigger = root.querySelector('button[aria-label="Select model family"]');
        const modelText = (trigger?.innerText || '').replace(/arrow_drop_down/g, '').trim();
        const ok = checked('Video') && checked('Ingredients') && checked('x1') &&
            (ratio === 'Flow' || checked(ratio)) && (model === 'Flow' || modelText === model);
        return { ok, model: modelText, video: checked('Video'), ingredients: checked('Ingredients'),
            ratio: ratio === 'Flow' || checked(ratio), x1: checked('x1') };
    }, { model, ratio });
    if (!verified.ok) throw Error('Compact Ingredients video settings did not verify: ' + JSON.stringify(verified));
    if (!/^Veo 3\.1 - (?:Lite|Fast)(?:\s|$)/i.test(verified.model)) {
        throw Error(`Flow currently selected "${verified.model}". Ingredients + Extend requires Veo 3.1 - Lite or Veo 3.1 - Fast.`);
    }

    await page.keyboard.press('Escape');
    log(`Ingredients video settings ready: Video / Ingredients / ${verified.model} / ${ratio} / x1; Agent Mode off.`);
    log('Clip 1 uses image ingredients; later Extend clips inherit continuity from the preceding clip (Flow does not allow ingredient chips in Extend).');
}

module.exports = { prepareReferences, prepareVideo, videoControl };
