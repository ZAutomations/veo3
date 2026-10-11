const GR = require('./generate_refs');

// Angular may retain hidden copies of the settings drawer. Only interact with
// the visible, enabled Save button; a click on a hidden copy does nothing.
function agentDrawerState() {
    const visible = el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none'
            && s.visibility !== 'hidden' && s.visibility !== 'collapse';
    };
    const panels = [...document.querySelectorAll('.settings-content, .settings-section')].filter(visible);
    const saves = [...document.querySelectorAll('button')].filter(b => {
        if (!visible(b) || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
        return b.classList.contains('settings-save-button')
            || /^save$/i.test((b.querySelector('.mdc-button__label')?.textContent || b.textContent || '').trim());
    });
    const button = saves.find(b => b.closest('.settings-content')) || saves[0];
    if (!panels.length) return { open: false };
    if (!button) return { open: true, save: null };
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = button.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { open: true, save: { x, y, clickable: !!hit && (hit === button || button.contains(hit)) } };
}

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

async function applyAgentSettings(page, { videoModel = '', aspect = 'Flow', resolution = 'Flow', log = () => {} } = {}) {
    const ratio = String(aspect || 'Flow').trim();
    if (!['Flow', '16:9', '1:1', '9:16'].includes(ratio)) throw Error(`Unsupported video aspect ratio: ${ratio}`);
    if (!['Flow','360p','720p'].includes(resolution)) throw Error('Choose Flow, 360p or 720p for Agent resolution.');
    if (!await GR.openSettingsPanel(page)) throw Error('Could not open Agent settings. Generation stopped.');
    if (videoModel && !/^(flow|auto|default|none)$/i.test(videoModel)) {
        const result = await GR.setSectionModel(page, 'video', videoModel);
        if (!result.ok) throw Error(`Could not select video model: ${result.why}`);
        log(`Video generation default: ${result.model}`);
    }
    // Agent resolution is requested in the prompt; this drawer has no resolution control.
    for (const kind of ['confirm', ...(ratio === 'Flow' ? [] : ['ratio'])]) {
        await page.evaluate(settingChoice, { kind, ratio, click: true });
        try {
            await page.waitForFunction(settingChoice, { timeout: 5000 }, { kind, ratio, click: false });
        } catch (_) {
            throw Error(`Could not verify ${kind==='confirm'?'confirmation Never':'video ratio '+ratio}. Generation stopped.`);
        }
    }
    const drawer = await page.evaluate(agentDrawerState);
    if (!drawer.save?.clickable) throw Error('Visible Agent settings Save button is unavailable or covered. Generation stopped.');
    await page.mouse.click(drawer.save.x, drawer.save.y);
    // Wait for Save to close the drawer; do not use Escape to discard changes.
    const deadline = Date.now() + 10000;
    while ((await page.evaluate(agentDrawerState)).open) {
        if (Date.now() > deadline) throw Error('Agent settings did not close after Save. Generation stopped.');
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    log(`Agent settings saved: confirmation Never; video ratio ${ratio}; resolution instruction ${resolution} (prompt only).`);
}

module.exports = { applyAgentSettings, settingChoice, agentDrawerState };
