// Browser DOM fixtures only; no Flow requests or credits.
const assert = require('assert');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { applyAgentSettings } = require('./agent_settings');

const fixture = native => `<button aria-label="Settings" onclick="document.querySelector('.settings-content').style.display='block'">Settings</button><div class="settings-content" style="display:none">
<div class="settings-section">Confirm before generating
${native ? '<label><input type="radio" name="confirm" checked>Always</label><label><input type="radio" name="confirm" value="never"><span class="radio-subtext">Agent will generate media and spend credits automatically.</span></label>'
    : '<button role="radio" aria-checked="true">Always</button><button role="radio" aria-checked="false"><span class="radio-label">Never</span><span class="radio-subtext">Agent will generate media and spend credits automatically.</span></button>'}
</div>
${['Image', 'Video'].map(kind => `<div class="settings-section" id="${kind}">${kind} generation default
<button aria-label="${kind} generation default model"><span class="mdc-button__label">${kind === 'Image' ? 'Nano Banana Pro' : 'Veo 3.1 - Fast'}</span></button>
${['16:9', '1:1', '9:16'].map(r => `<button role="radio" aria-checked="${r === '16:9'}"><mat-icon>crop_16_9</mat-icon><span class="toggle-text">${r}</span></button>`).join('')}</div>`).join('')}
<button class="settings-save-button"><span class="mdc-button__label"> Save </span></button></div>
<script>
document.querySelectorAll('button[role="radio"]').forEach(b => b.onclick = () => {
 b.parentElement.querySelectorAll('[role="radio"]').forEach(r => r.setAttribute('aria-checked', String(r === b)));
});
document.querySelector('.settings-save-button').onclick = () => {
 window.saved = {
 never: !!document.querySelector('input[value="never"]:checked') || [...document.querySelectorAll('[aria-checked="true"]')].some(b => b.textContent.startsWith('Never')),
 image: document.querySelector('#Image [aria-checked="true"] .toggle-text').textContent,
 video: document.querySelector('#Video [aria-checked="true"] .toggle-text').textContent,
 };
 document.querySelector('.settings-content').style.display = 'none';
};
</script>`;

(async () => {
 const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
   'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
 const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
 try {
  const page = await browser.newPage();
  for (const ratio of ['16:9', '1:1', '9:16', 'Flow']) {
   for (const native of [false, true]) {
    await page.setContent(fixture(native));
    await applyAgentSettings(page, { videoModel: 'Veo 3.1 - Fast', aspect: ratio });
    const saved = await page.evaluate(() => window.saved);
    assert.deepEqual(saved, { never: true, image: '16:9', video: ratio === 'Flow' ? '16:9' : ratio });
   }
  }
  await page.setContent(fixture(false));
  await page.evaluate(() => document.querySelector('#Video [aria-checked="false"]').remove());
  await assert.rejects(applyAgentSettings(page, { aspect: '1:1' }), /Could not verify video ratio/);
  assert.equal(await page.evaluate(() => document.querySelector('.settings-content').style.display), 'block');
  await page.setContent(fixture(false));
  await page.evaluate(() => document.querySelector('.radio-label').parentElement.onclick = () => {});
  await assert.rejects(applyAgentSettings(page, { aspect: '16:9' }), /Could not verify Confirm/);
  await assert.rejects(applyAgentSettings(page, { aspect: '4:3' }), /Unsupported/);
  console.log('Agent settings checks passed: all GUI ratios, Never, native radios, Save, image ratio isolation, failure stops.');
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
