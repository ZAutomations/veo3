'use strict';
const fs = require('fs');
const path = require('path');
const { installGridScroller, gridMetrics, scrollGrid } = require('./flow_grid_scroll');
const { normalizeProjectUrl } = require('./flow_project');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function thumbnailTiles(page) {
    return page.evaluate(() => {
        const scroller = window.__veoGridScroller?.() || null;
        const bounds = scroller?.getBoundingClientRect() || { x: 0, y: 0 };
        const top = scroller ? scroller.scrollTop : window.scrollY;
        const left = scroller ? scroller.scrollLeft : window.scrollX;
        return [...document.querySelectorAll('flow-image-tile, [class*=image-tile]')]
            .filter(tile => { const r = tile.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
            .map(tile => {
                const r = tile.getBoundingClientRect();
                const title = tile.querySelector('.asset-title,.footer-title,[data-asset-title]')?.textContent?.trim()
                    || tile.querySelector('flow-tile-hover-footer .footer-left[aria-label]')?.getAttribute('aria-label') || '';
                const text = (tile.innerText || tile.textContent || '').trim();
                const media = [...tile.querySelectorAll('img,video,source')].map(el => el.currentSrc || el.getAttribute('src') || '').join(' ');
                const assetId = (media.match(/\/(?:image|asb)\/([^=?/#\s]+)/) || [])[1] || '';
                return { title, text, assetId, gridX: Math.round(left + r.x - bounds.x), gridY: Math.round(top + r.y - bounds.y) };
            });
    });
}

function isThumbnail(tile) {
    const normalized = `${tile.title || ''} ${tile.text || ''}`
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/(?:favorite|more_vert|redo|image|add_2|download)/gi, ' ')
        .replace(/\s+/g, ' ');
    return /\bthumbnail\b/i.test(normalized) && !!tile.assetId;
}

async function findThumbnailTile(page, log = () => {}) {
    await page.evaluate(installGridScroller);
    await page.waitForSelector('flow-image-tile, [class*=image-tile]', { timeout: 30000 }).catch(() => {});
    const records = new Map();
    const merge = tiles => {
        for (const tile of tiles) {
            const key = tile.assetId || `${tile.gridY}:${tile.gridX}`;
            if (!records.has(key)) records.set(key, tile);
        }
    };
    await page.evaluate(scrollGrid, 0);
    for (let round = 0; round < 120; round++) {
        merge(await thumbnailTiles(page));
        const matches = [...records.values()].filter(isThumbnail).sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
        if (matches.length) return matches[0];
        const before = await page.evaluate(gridMetrics);
        if (before.mediaCovered || before.top >= (before.mediaEnd ?? before.scroll) - before.client - 2) break;
        const target = Math.min(Math.max(0, (before.mediaEnd ?? before.scroll) - before.client), before.top + Math.max(120, Math.floor(before.client * 0.72)));
        if (target <= before.top + 2) break;
        await page.evaluate(scrollGrid, target);
        await wait(350);
        const after = await page.evaluate(gridMetrics);
        if (after.top <= before.top + 2) break;
    }
    merge(await thumbnailTiles(page));
    const matches = [...records.values()].filter(isThumbnail).sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
    if (!matches.length) throw Error('No completed image tile named "Thumbnail" was found in this Flow project. Generate the preset thumbnail with the reference images, then retry download/join.');
    return matches[0];
}

async function downloadStoryThumbnail(page, storyFile, projectUrl, log = () => {}) {
    if (!storyFile || !fs.existsSync(storyFile)) throw Error('Cannot locate the story file for its preset thumbnail.');
    const story = JSON.parse(fs.readFileSync(storyFile, 'utf8').replace(/^\uFEFF/, ''));
    if (!require('./thumbnail_prompt').isFlowEndcardPreset(story)) return null;
    const home = normalizeProjectUrl(projectUrl || page.url());
    let current = '';
    try { current = normalizeProjectUrl(page.url()); } catch {}
    if (current !== home) await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const tile = await findThumbnailTile(page, log);
    const folder = path.dirname(path.resolve(storyFile));
    const receiptFile = path.join(folder, 'thumbnail_downloaded.json');
    let receipt = {};
    try { receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8')); } catch {}
    const saved = ['.png', '.jpg', '.jpeg', '.webp'].map(ext => path.join(folder, 'thumbnail_downloaded' + ext))
        .find(file => fs.existsSync(file) && fs.statSync(file).size > 2048);
    if (saved && receipt.assetId === tile.assetId) {
        log(`Preset thumbnail already downloaded and verified: ${saved}`);
        return saved;
    }
    const file = await require('./flow_thumbnail_download').downloadThumbnail(page, tile, folder, log);
    fs.writeFileSync(receiptFile, JSON.stringify({ assetId: tile.assetId, file: path.basename(file), downloadedAt: new Date().toISOString() }, null, 2) + '\n');
    return file;
}

module.exports = { thumbnailTiles, isThumbnail, findThumbnailTile, downloadStoryThumbnail };
