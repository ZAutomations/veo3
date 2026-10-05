const GR = require('./generate_refs');

// Runs in the page. Scope ratios to VIDEO so the reference-sheet ratio stays put.
function settingChoice({ kind, ratio, click }) {
    const visible = el => !!(el && el.getBoundingClientRect().width && el.getBoundingClientRect().height);
    const heading = kind === 'confirm' ? /confirm before generating/i : /video generation default/i;
    const section = [...document.querySelectorAll('.settings-section')]
        .find(el => visible(el) && heading.test(el.innerText || ''));
    if (!section) return false;
    const candidates = [...section.querySelectorAll('[role="radio"], mat-radio-button, button, label')];
    const target = candidates.find(el => {
        if (!visible(el)) return false;
        if (kind === 'ratio') return (el.querySelector('.toggle-text')?.textContent || '').trim() === ratio;
        const label = (el.querySelector('.radio-label')?.textContent || el.textContent || '').trim();
        return /^never\b/i.test(label) || /Agent will generate media and spend credits automatically/i.test(label);
    });
    if (!target) return false;
    const input = target.querySelector('input[type="radio"]')
        || (target.tagName === 'LABEL' && target.control);
    const selected = target.getAttribute('aria-checked') === 'true' || !!input?.checked
        || target.querySelector('[role="radio"][aria-checked="true"]') !== null;
    if (!selected && click) (input || target).click();
    return selected;
}

async function applyAgentSettings(page, { videoModel = '', aspect = 'Flow', log = () => {} } = {}) {
    const ratio = String(aspect || 'Flow').trim();
    if (!['Flow', '16:9', '1:1', '9:16'].includes(ratio)) throw Error(`Unsupported video aspect ratio: ${ratio}`);
    if (!await GR.openSettingsPanel(page)) throw Error('Could not open Agent settings. Generation stopped.');
    if (videoModel && !/^(flow|auto|default|none)$/i.test(videoModel)) {
        const result = await GR.setSectionModel(page, 'video', videoModel);
        if (!result.ok) throw Error(`Could not select video model: ${result.why}`);
        log(`Video generation default: ${result.model}`);
    }
    for (const kind of ['confirm', ...(ratio === 'Flow' ? [] : ['ratio'])]) {
        await page.evaluate(settingChoice, { kind, ratio, click: true });
        try {
            await page.waitForFunction(settingChoice, { timeout: 5000 }, { kind, ratio, click: false });
        } catch (_) {
            throw Error(`Could not verify ${kind === 'confirm' ? 'Confirm before generating: Never' : 'video ratio: ' + ratio}. Generation stopped.`);
        }
    }
    if (!await GR.clickSave(page)) throw Error('Agent settings Save button was not found. Generation stopped.');
    // Wait for Save to close the drawer; do not use Escape to discard changes.
    const deadline = Date.now() + 10000;
    while (await GR.settingsPanelOpen(page)) {
        if (Date.now() > deadline) throw Error('Agent settings did not close after Save. Generation stopped.');
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    log(`Agent settings saved: confirmation Never; video ratio ${ratio === 'Flow' ? 'unchanged (Flow)' : ratio}.`);
}

module.exports = { applyAgentSettings, settingChoice };
