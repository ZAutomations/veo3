const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer');
const { uploadSavedReference, openUploadChooser } = require('./upload_saved_reference');
(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-sheet-upload-'));
    const image = path.join(dir, 'my-female-sheet.png');
    fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLp0AAAAASUVORK5CYII=', 'base64'));
    const browser = await puppeteer.launch({ headless: true });
    const project = 'test-saved-sheet-' + Date.now();
    const marker = path.join(__dirname, 'logs', 'saved_couple_uploads', project + '.json');
    try {
        const tab = await browser.newPage();
        await tab.setContent(`<button aria-label="Add media menu" onclick="document.querySelector('.cdk-overlay-container').style.display='block'">Add</button>
            <div class="cdk-overlay-container" style="display:none"><button onclick="document.querySelector('input').click()">Upload media</button></div>
            <input type="file" style="display:none" onchange="window.uploaded=this.files[0].name">`);
        const page = new Proxy(tab, { get(target, key) { if (key === 'url') return () => 'https://flow.google.com/project/' + project;
            const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
        const deps = { waitImage: async () => ({ ok: true, tileIndex: 0 }), rename: async (pg, name) => {
            await pg.evaluate(name => { const tile = document.createElement('flow-image-tile'); tile.innerText = name; document.body.append(tile); }, name);
            return { ok: true };
        } };
        const result = await uploadSavedReference(page, { name: 'Sarah', localFile: image }, () => {}, deps);
        assert(result.ok);
        assert.strictEqual(await tab.evaluate(() => window.uploaded), 'my-female-sheet.png');
        assert((await uploadSavedReference(page, { name: 'Sarah', localFile: image }, () => {}, deps)).reused,
            'unchanged sheet is not uploaded twice into the same project');
        await tab.setContent(`<flow-image-tile><img src="data:image/png;base64,${fs.readFileSync(image).toString('base64')}">
            <div class="hover-overlay"><button aria-label="More options">...</button></div>
            <span class="footer-title" style="visibility:hidden">my-female-sheet.png</span></flow-image-tile>`);
        await tab.waitForFunction(() => document.querySelector('img').naturalWidth > 0);
        const recovered = await uploadSavedReference(page, { name: 'George', localFile: image }, () => {}, {
            rename: async (pg, name, index) => {
                assert.strictEqual(index, 0);
                await pg.evaluate(name => { document.querySelector('.footer-title').textContent = name; }, name);
                return { ok: true };
            },
        });
        assert(recovered.ok && recovered.reused, 'unfinished rename recovers existing filename tile');
        assert((await uploadSavedReference(page, { name: 'George', localFile: image }, () => {}, deps)).reused,
            'hidden footer text still identifies an already uploaded and renamed image');
        await tab.setContent(`<button aria-label="Add media menu" onclick="setTimeout(()=>document.querySelector('.menu').style.display='block',800)">+</button>
            <div class="menu" style="display:none"><button role="menuitem" onclick="if(event.isTrusted)document.querySelector('input').click()"><span class="label">Upload</span></button></div>
            <input type="file" style="display:none" onchange="window.uploaded=this.files[0].name">`);
        const delayedChooser = await openUploadChooser(page);
        await delayedChooser.accept([image]);
        assert.strictEqual(await tab.evaluate(() => window.uploaded), 'my-female-sheet.png');
        await tab.setContent(`<button aria-label="Add ingredients to the prompt box" onclick="document.querySelector('.picker').style.display='block'">+</button>
            <div class="picker" style="display:none"><button onclick="if(event.isTrusted)document.querySelector('input').click()"><span class="upload-text">Upload media</span></button></div>
            <input type="file" style="display:none" onchange="window.uploaded=this.files[0].name">`);
        const pickerChooser = await openUploadChooser(page);
        await pickerChooser.accept([image]);
        assert.strictEqual(await tab.evaluate(() => window.uploaded), 'my-female-sheet.png');
        await tab.setContent(`<button role="menuitem" onclick="document.querySelector('input').click()"><span class="label">Upload</span></button>
            <input type="file" style="display:none" onchange="window.uploaded=this.files[0].name">`);
        let replaced = false;
        const rerenderPage = new Proxy(page, { get(target, key) {
            if (key === 'evaluateHandle') return async (...args) => {
                const handle = await target.evaluateHandle(...args);
                if (!replaced) {
                    replaced = true;
                    await tab.evaluate(() => {
                        const old = document.querySelector('button');
                        old.replaceWith(old.cloneNode(true));
                    });
                }
                return handle;
            };
            return target[key];
        } });
        const rerenderChooser = await openUploadChooser(rerenderPage);
        await rerenderChooser.accept([image]);
        assert.strictEqual(await tab.evaluate(() => window.uploaded), 'my-female-sheet.png');
        console.log('PASS: Angular replacing the discovered Upload button cannot leave a stale click handle.');
        console.log('PASS: delayed Upload menus and prompt-box picker use trusted clicks to open the chooser.');
        console.log('PASS: real file chooser accepts the saved image, names it Sarah, and avoids repeated uploads. Fixture only; no Flow requests.');
    } finally {
        await browser.close();
        if (fs.existsSync(marker)) fs.unlinkSync(marker);
        fs.rmSync(dir, { recursive: true, force: true });
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
