const GR = require('./generate_refs');

// Main-page Settings has the same icon/label. Only the Agent footer owns this
// action; never fall back to a page-wide Settings search.
function clickAgentSettings() {
    const visible = el => {
        if (el.closest?.('.agent-panel-slide-out')) return false;
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const editor = window.__veoAgentEditor?.();
    const owner = editor?.closest('.agent-panel-wrapper')
        || editor?.closest('.agent-panel-prompt-box');
    const footers = [...document.querySelectorAll('.agent-footer-actions')].filter(visible);
    const roots = owner ? [...footers.filter(f => owner.contains(f)), owner] : footers;
    for (const root of roots) {
        const buttons = [...root.querySelectorAll('button')].filter(b => visible(b)
            && !b.disabled && b.getAttribute('aria-disabled') !== 'true'
            && ([...b.querySelectorAll('mat-icon')].some(i => i.textContent.trim() === 'tune')
                || /^settings(?:\s+trigger)?$/i.test(b.getAttribute('aria-label') || '')));
        if (buttons.length === 1) {
            buttons[0].click();
            return true;
        }
    }
    return false;
}

function agentSettingsReady() {
    const visible = el => {
        if (el.closest?.('.agent-panel-slide-out')) return false;
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    return [...document.querySelectorAll('.settings-content')].some(panel => visible(panel)
        && /confirm before generating/i.test(panel.innerText || '')
        && /video generation default/i.test(panel.innerText || '')
        && [...(panel.closest?.('flow-settings-view') || panel.parentElement || panel).querySelectorAll('button')].some(b => visible(b) && !b.disabled
            && /^save$/i.test((b.querySelector('.mdc-button__label')?.textContent || b.textContent || '').trim())));
}

async function openAgentSettings(page) {
    // Flow commits drawer/ingredient updates on animation frames. A hidden
    // project tab can accept clicks while leaving those updates suspended.
    if (page.bringToFront) await page.bringToFront();
    if (await page.evaluate(agentSettingsReady)) return true;
    if (!await page.evaluate(clickAgentSettings)) return false;
    try {
        await page.waitForFunction(agentSettingsReady, { timeout: 8000 });
        return true;
    } catch (_) { return false; }
}

function clickAgentSave() {
    const visible = el => {
        if (el.closest?.('.agent-panel-slide-out')) return false;
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const panels = [...document.querySelectorAll('.settings-content')];
    const panel = panels.find(p => visible(p)
        && /confirm before generating/i.test(p.innerText || '')
        && /video generation default/i.test(p.innerText || ''));
    if (!panel) return false;
    const root = panel.closest('flow-settings-view') || panel.parentElement || panel;
    const button = [...root.querySelectorAll('button')].find(b => !b.disabled
        && b.getAttribute('aria-disabled') !== 'true' && visible(b)
        && /^save$/i.test((b.querySelector('.mdc-button__label')?.textContent || b.textContent || '').trim()));
    if (!button) return false;
    button.click();
    return true;
}

// Angular may retain hidden copies of the settings drawer. Only interact with
// the visible, enabled Save button; a click on a hidden copy does nothing.
function agentDrawerState() {
    const visible = el => {
        if (el.closest?.('.agent-panel-slide-out')) return false;
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none'
            && s.visibility !== 'hidden' && s.visibility !== 'collapse'
            && !el.closest?.('[aria-hidden="true"], [inert]')
            && (r.bottom === undefined || r.bottom > 0) && (r.right === undefined || r.right > 0)
            && (typeof innerHeight === 'undefined' || r.top === undefined || r.top < innerHeight)
            && (typeof innerWidth === 'undefined' || r.left === undefined || r.left < innerWidth);
    };
    const panels = [...document.querySelectorAll('.settings-content')].filter(p => visible(p)
        && /confirm before generating/i.test(p.innerText || '')
        && /video generation default/i.test(p.innerText || ''));
    if (!panels.length) return { open: false };
    if (panels.length !== 1) return {open:true,save:null};
    const root=panels[0].closest('flow-settings-view') || panels[0].parentElement || panels[0];
    const saves = [...root.querySelectorAll('button')].filter(b => {
        // An enabled Save below the viewport must be scrolled into view before
        // hit testing. Filtering it out here made it permanently "missing".
        const r=b.getBoundingClientRect(),s=getComputedStyle(b);
        if (!r.width || !r.height || s.display==='none' || s.visibility==='hidden'
            || b.closest?.('[aria-hidden="true"], [inert]')
            || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
        return b.classList.contains('settings-save-button')
            || /^save$/i.test((b.querySelector('.mdc-button__label')?.textContent || b.textContent || '').trim());
    });
    const button = saves.length===1 ? saves[0] : null;
    if (!button) return { open: true, save: null };
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = button.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { open: true, save: { x, y, clickable: !!hit && (hit === button || button.contains(hit)) } };
}

async function saveAgentSettings(page,{log=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
    for(let attempt=0;attempt<2;attempt++) {
        let state,previous=null,ready=false;
        // Model menus, layout updates and smooth scrolling briefly cover or
        // move Save. Wait for two stable hit tests instead of failing on the
        // first frame after changing the model/ratio.
        for(let poll=0;poll<40;poll++) {
            state=await page.evaluate(agentDrawerState);
            if(!state.open)return;
            const target=state.save;
            if(target?.clickable && previous?.clickable
                && Math.abs(target.x-previous.x)<1 && Math.abs(target.y-previous.y)<1){ready=true;break;}
            previous=target;
            if(poll===4)log('Waiting for Agent Save to finish moving or become uncovered.');
            await wait(250);
        }
        if(!ready)throw Error('Agent settings Save stayed unavailable for 10 seconds after the model/ratio change. No generation submitted.');
        await page.mouse.click(state.save.x,state.save.y);
        for(let poll=0;poll<20;poll++) {
            await wait(250);
            if(!(await page.evaluate(agentDrawerState)).open)return;
        }
        if(!attempt)log('Agent settings are still visible; retrying the visible Save button once.');
    }
    throw Error('Agent settings remained visible after two verified Save clicks. No generation submitted.');
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
    if (!await openAgentSettings(page)) throw Error('Could not open verified Agent settings from the Agent composer. Generation stopped.');
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
    await saveAgentSettings(page,{log});
    log(`Agent settings saved: confirmation Never; video ratio ${ratio}; resolution instruction ${resolution} (prompt only).`);
}

module.exports = { applyAgentSettings, saveAgentSettings, settingChoice, agentDrawerState, clickAgentSettings, agentSettingsReady, openAgentSettings, clickAgentSave };
