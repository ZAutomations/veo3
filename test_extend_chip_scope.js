const assert = require('assert');
const puppeteer = require('puppeteer');
const { Veo3FlowNewUI } = require('./veo3_flow_new_ui');
(async () => {
    const browser = await puppeteer.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const engine = Object.create(Veo3FlowNewUI.prototype);
        engine.page = page;
        await page.setContent(`<div class="editor-history-container"><div class="ingredients-list">
            <button aria-label="Ingredient">Sarah</button><button aria-label="Ingredient">George</button>
            <button aria-label="Ingredient">Sanctuary</button></div></div>
            <flow-base-prompt-box><div class="base-prompt-box"><div class="ProseMirror" contenteditable="true">old</div></div></flow-base-prompt-box>`);
        assert.strictEqual((await engine.ingredientChipState()).count, 0);
        await engine.removeIngredientChipsFromExtend();
        await engine.typePrompt('Continue scene 2 from the previous final frame.');
        assert.strictEqual(await page.$eval('.ProseMirror', e => e.textContent), 'Continue scene 2 from the previous final frame.');
        assert.strictEqual(await page.$$eval('.editor-history-container button', e => e.length), 3);
        await page.evaluate(() => {
            const chip = document.createElement('button');
            chip.setAttribute('aria-label', 'Ingredient');
            chip.innerHTML = '<span class="cancel">cancel</span>';
            chip.querySelector('.cancel').onclick = () => chip.remove();
            document.querySelector('.base-prompt-box').append(chip);
        });
        assert.strictEqual((await engine.ingredientChipState()).count, 1);
        await engine.removeIngredientChipsFromExtend();
        assert.strictEqual((await engine.ingredientChipState()).count, 0);
        assert.strictEqual(await page.$$eval('.editor-history-container button', e => e.length), 3);
        console.log('PASS: history ingredients never block Extend prompt entry; real prompt ingredients are cleared.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
