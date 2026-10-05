// Local browser fixtures only: no Flow account, requests, keys or credits.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const puppeteer = require('puppeteer');
const R = require('./reference_image_step');
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log('  ok ' + name); }

const fixture = `
<style>button{padding:12px;margin:5px} .cdk-overlay-pane{padding:12px;border:1px solid} [hidden]{display:none!important}
flow-image-tile,flow-video-tile{display:block;width:180px;height:80px} img{width:40px;height:40px}</style>
<flow-agent-mode-toggle-chip><button aria-pressed="false" class="agent-mode-chip">Agent</button></flow-agent-mode-toggle-chip>
<button id="summary"><span class="settings-summary">Veo 3.1 Quality <mat-icon>crop_9_16</mat-icon> x1</span></button>
<div id="panel" class="cdk-overlay-pane" hidden>
 <button id="image" role="radio" aria-checked="false"><mat-icon>image</mat-icon><span class="toggle-text">Image</span></button>
 <button id="video" role="radio" aria-checked="true"><span class="toggle-text">Video</span></button>
 <button id="ratio" role="radio" aria-checked="false"><mat-icon>crop_16_9</mat-icon><span class="toggle-text">16:9</span></button>
 <button id="portrait" role="radio" aria-checked="true"><span class="toggle-text">9:16</span></button>
 <button id="picker" aria-label="Select model family"><span class="model-select-trigger-content">Veo 3.1 Quality <mat-icon>arrow_drop_down</mat-icon></span></button>
</div>
<div id="menu" class="cdk-overlay-pane" hidden>
 <button role="menuitem" id="lite"><span class="label">🍌 Nano Banana</span></button>
 <button role="menuitem" id="preview"><span class="label">🍌 Nano Banana Pro Preview</span></button>
 <button role="menuitem" id="pro"><span class="label">🍌 Nano Banana Pro</span></button>
</div>
<div hidden><button role="radio" aria-checked="true"><span class="toggle-text">Image</span></button></div>
<div class="ProseMirror" contenteditable="true"></div><button aria-label="Start generation" id="generate">Generate</button>
<div id="assets"></div>
<script>
(() => {
window.actions=[]; window.videoDefault='Veo 3.1 Quality'; window.videoRatio='9:16';
const el=id=>document.getElementById(id);
const checked=(id,value)=>el(id).setAttribute('aria-checked',String(value));
el('summary').onclick=()=>{actions.push('summary');el('panel').hidden=!el('panel').hidden};
el('image').onclick=()=>{actions.push('image');if(!window.deadImage){checked('image',true);checked('video',false)}};
el('ratio').onclick=()=>{actions.push('ratio');checked('ratio',true);checked('portrait',false)};
el('picker').onclick=()=>{actions.push('model');el('menu').hidden=false};
for(const id of ['lite','preview','pro']) el(id).onclick=()=>{
 actions.push(id);el('picker').innerHTML='<span>'+el(id).innerHTML+'<mat-icon>arrow_drop_down</mat-icon></span>';el('menu').hidden=true;
};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){
 if(!el('menu').hidden){el('menu').hidden=true;return;}
 el('panel').hidden=true;
 document.querySelector('.settings-summary').innerHTML='🍌 Nano Banana Pro <mat-icon>crop_16_9</mat-icon> x1';
}});
el('generate').onclick=()=>actions.push('SUBMIT');
})();
</script>`;

async function browserTests(page) {
    const reset = async () => { await page.goto('about:blank'); await page.setContent(fixture); };
    await reset();
    await R.configureReferenceImages(page);
    check('Video selection is changed to Image, 16:9 and exact Nano Banana Pro in order',
        (await page.evaluate(() => actions.join(','))) === 'summary,image,ratio,model,pro');
    check('compact controls close after verification', !(await page.evaluate(R.compactControls, 'state')).open);
    check('reference settings do not write the film video defaults',
        await page.evaluate(() => videoDefault === 'Veo 3.1 Quality' && videoRatio === '9:16'));
    await R.configureReferenceImages(page);
    check('a subsequent reference rechecks the same selections', (await page.evaluate(() => actions.filter(x => x === 'pro').length)) === 2);

    await reset();
    await page.evaluate(() => { window.deadImage = true; });
    await assert.rejects(R.configureReferenceImages(page), /Image mode did not become selected/);
    check('dead Image toggle never proceeds to model selection or generation',
        !(await page.evaluate(() => actions.some(x => x === 'model' || x === 'SUBMIT'))));
    await reset();
    await page.evaluate(() => document.getElementById('pro').remove());
    await assert.rejects(R.configureReferenceImages(page), /cannot find pro control/);
    check('missing Pro option does not choose Banana or Pro Preview',
        !(await page.evaluate(() => actions.some(x => ['lite','preview','SUBMIT'].includes(x)))));

    await reset();
    const pixel = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>');
    const add = async html => page.evaluate(s => document.getElementById('assets').insertAdjacentHTML('afterbegin', s), html);
    const tile = src => `<flow-image-tile><img src="${src}"><div class="hover-overlay"><button aria-label="More options">Menu</button></div></flow-image-tile>`;
    await add(tile(pixel));
    await page.waitForFunction(() => document.querySelector('flow-image-tile img').naturalWidth > 0);
    let before = await page.evaluate(R.referenceState);
    check('an already completed image is captured in baseline', before.images.length === 1);
    await add('<div class="error-tile">Failed. We noticed some unusual activity. Please visit the Help Center.<button aria-label="More options">Menu</button></div>');
    let result = await R.waitForReferenceImage(page, before, 0.1);
    check('unusual activity is a cooldown result, never image success', !result.ok && result.unusual);
    before = await page.evaluate(R.referenceState);
    await add('<flow-image-tile><div role="progressbar">Generating</div><div class="hover-overlay"><button aria-label="More options">Menu</button></div></flow-image-tile>');
    result = await R.waitForReferenceImage(page, before, 0.05);
    check('a pending tile and a stale error do not count as success or a new block', !result.ok && !result.unusual && /No completed/.test(result.why));
    const nextPixel = pixel.replace('blue', 'red');
    await add(tile(nextPixel));
    await page.waitForFunction(() => document.querySelector('flow-image-tile img').naturalWidth > 0);
    result = await R.waitForReferenceImage(page, before, 0.1);
    check('retry can succeed while an old failed tile remains on screen', result.ok && result.tileIndex === 0);
    before = await page.evaluate(R.referenceState);
    await add('<div class="error-tile">Failed. We noticed and unusual activity, plz visit the help center.</div>');
    result = await R.waitForReferenceImage(page, before, 0.1);
    check('a second identical activity failure is detected as a new error', result.unusual);
    before = await page.evaluate(R.referenceState);
    await add('<flow-video-tile><video></video></flow-video-tile>');
    result = await R.waitForReferenceImage(page, before, 0.1);
    check('a new video tile is rejected', !result.ok && /video tile/.test(result.why));
    before = await page.evaluate(R.referenceState);
    await add('<div class="error-tile">Failed to generate this image.</div>');
    result = await R.waitForReferenceImage(page, before, 0.1);
    check('ordinary failures do not trigger the unusual-activity retry loop', !result.ok && !result.unusual);

    await reset();
    await page.evaluate(src => {
        const chip = document.querySelector('flow-agent-mode-toggle-chip button');
        chip.setAttribute('aria-pressed', 'true');
        chip.parentElement.className = 'checked';
        chip.onclick = () => {
            const on = chip.getAttribute('aria-pressed') !== 'true';
            chip.setAttribute('aria-pressed', String(on));
            chip.parentElement.className = on ? 'checked' : '';
        };
        document.getElementById('assets').innerHTML = '<div class="error-tile">Old failed image<div class="hover-overlay"><button aria-label="More options" id="old">Old</button></div></div>';
        document.getElementById('old').onclick = () => { window.wrongTile = true; };
        document.getElementById('generate').onclick = () => {
            window.submitted = document.querySelector('.ProseMirror').textContent;
            document.getElementById('assets').insertAdjacentHTML('beforeend', '<flow-image-tile><img src="' + src + '"><div class="hover-overlay"><input class="editable-text-input" value="New image"><button aria-label="More options" id="new">Menu</button></div></flow-image-tile>');
            document.getElementById('new').onclick = () => {
                const rename = document.createElement('button');
                rename.className = 'mat-mdc-menu-item'; rename.textContent = 'Rename';
                document.body.append(rename);
                rename.onclick = () => {
                    rename.remove();
                    const overlay = document.createElement('div'); overlay.className = 'rename-tile-overlay';
                    overlay.innerHTML = '<input class="editable-text-input"><button aria-label="Done">Done</button>';
                    document.body.append(overlay);
                    overlay.querySelector('button').onclick = () => {
                        window.renamed = overlay.querySelector('input').value;
                        document.querySelector('flow-image-tile input').value = window.renamed;
                        overlay.remove();
                    };
                };
            };
        };
    }, pixel);
    const G = require('./generate_refs');
    const generated = await G.generateRefs(page, [{ name: 'Leo', prompt: 'A reference sheet for Leo.' }], { waitS: 2, log() {} });
    check('the integrated reference step generates and renames a completed image',
        generated.made === 1 && generated.failed === 0 && await page.evaluate(() => renamed === 'Leo' && submitted === 'A reference sheet for Leo.'));
    check('rename targets the successful image even when an older failure is first', await page.evaluate(() => !window.wrongTile));
    check('Agent Mode is re-enabled after successful reference generation', await G.agentOn(page) === true);
}

async function waitTests() {
    let attempts = 0, elapsed = 0;
    const result = await R.withActivityWait(async () => {
        attempts++;
        if (attempts === 2) assert.equal(elapsed, 120000);
        return attempts === 1 ? { ok: false, unusual: true } : { ok: true };
    }, { sleep: async ms => { elapsed += ms; } });
    check('successful retry waits a full two minutes before resubmitting', result.ok && attempts === 2 && elapsed === 120000);
    attempts = 0; elapsed = 0;
    const blocked = await R.withActivityWait(async () => { attempts++; return { ok: false, unusual: true }; },
        { sleep: async ms => { elapsed += ms; } });
    check('persistent activity warning stops after two delayed retries', blocked.blocked && attempts === 3 && elapsed === 240000);
    attempts = 0;
    await R.withActivityWait(async () => { attempts++; return { ok: false, why: 'Other failure' }; },
        { sleep: async () => { throw Error('must not wait'); } });
    check('unrelated failures are not resubmitted', attempts === 1);
    check('MCP timeout covers attempts and waits for every reference',
        R.referenceTimeoutMs(3, 180) >= 3 * (3 * 180000 + 240000));
}

// Exercise the real MCP handlers with subprocesses replaced by local results.
// A persistent block must prevent the next film from creating more requests.
async function batchTests() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-ref-batch-'));
    try {
        const story = path.join(tmp, 'example_story.json');
        fs.writeFileSync(story, JSON.stringify({ title: 'Example', scenes: [] }));
        fs.writeFileSync(path.join(tmp, 'refs.json'), JSON.stringify({ refs: [{ name: 'Leo', prompt: 'Leo' }] }));
        const calls = [];
        const fakeSpawn = (_exe, args) => {
            const name = path.basename(args[0]); calls.push(name);
            const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
            setImmediate(() => {
                if (name === 'project_setup.js') child.stdout.emit('data', 'project_url : https://flow.google.com/project/test\n');
                if (name === 'generate_refs.js') child.stdout.emit('data', R.ACTIVITY_BLOCKED + '\n');
                child.emit('close', name === 'generate_refs.js' ? 4 : 0);
            });
            return child;
        };
        const sandbox = { module: { exports: {} }, __dirname, require: n => n === 'child_process' ? { spawn: fakeSpawn } : require(n),
            process: { ...process, stderr: { write() {} } }, console, setTimeout, clearTimeout, Buffer };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'mcp_server.js'), 'utf8'), sandbox);
        const batch = sandbox.module.exports.TOOLS.find(t => t.name === 'batch_pipeline');
        const result = await batch.handler({ stories: [story, story], generate: true, submit: true, new_project: true, generate_refs: true });
        check('persistent reference block is an MCP error with a resume index', result.isError && /Resume from 1/.test(result.content[0].text));
        check('batch stops before video generation and before the second film', calls.join(',') === 'story_to_agent_prompt.js,project_setup.js,generate_refs.js');
    } finally {
        // Only the exact temporary directory created above is removed.
        assert.equal(path.dirname(tmp), os.tmpdir());
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

(async () => {
    await waitTests();
    await batchTests();
    const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => p && fs.existsSync(p));
    const browser = await puppeteer.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
    try { await browserTests(await browser.newPage()); }
    finally { await browser.close(); }
    console.log(`\n${checks} reference-image checks passed.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
