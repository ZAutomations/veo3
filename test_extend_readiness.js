const assert = require('assert');
const puppeteer = require('puppeteer');
const { Veo3FlowNewUI } = require('./veo3_flow_new_ui');
(async () => {
    const browser = await puppeteer.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const engine = Object.create(Veo3FlowNewUI.prototype);
        engine.page = page;
        engine.sel = { addClipLabel: 'Add clip', placeholderSelector: '.prosemirror-placeholder', extendPlaceholder: 'What happens next' };
        engine.opts = {};
        for (const text of [' ', 'Previously entered prompt']) {
            await page.setContent(`<div class="clip"></div><div class="clip"></div>
                <div class="clip extend-composing">Prompt to extend</div>
                <button aria-label="Exit extend mode">Extend (Veo 3.1 - Lite)</button>
                <div class="ProseMirror" contenteditable="true">${text}</div>`);
            assert(await engine.isExtendArmed(), 'composer stays armed without a placeholder');
            await engine.waitForEditorReady(1000);
            await engine.armExtend(3);
            await engine.typePrompt('Scene 3 exact continuation.');
            assert.strictEqual(await page.$eval('.ProseMirror', e => e.textContent.trim()), 'Scene 3 exact continuation.');
            assert.strictEqual(await page.$$eval('.clip', els => els.length), 3, 'no additional slot was added');
        }
        await page.setContent('<div class="clip"></div><div class="ProseMirror" contenteditable="true"> </div>');
        assert.strictEqual(await engine.isExtendArmed(), false, 'regular editor is not mistaken for Extend');
        await page.setContent('<span class="prosemirror-placeholder">What happens next?</span><div class="ProseMirror" contenteditable="true"></div>');
        assert(await engine.isExtendArmed(), 'older placeholder UI still works');
        console.log('PASS: whitespace/filled Extend composers are ready without Add clip; no duplicate slots or submissions.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
