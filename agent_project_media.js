// Inventory the whole Flow project, including pages unmounted by its virtual grid.
function projectFrame() {
    const scroller = window.__veoGridScroller?.() || null;
    const bounds = scroller ? scroller.getBoundingClientRect() : { x: 0, y: 0 };
    const top = scroller ? scroller.scrollTop : window.scrollY;
    const left = scroller ? scroller.scrollLeft : window.scrollX;
    const extent = window.__veoGridExtent?.();
    const tiles = [...document.querySelectorAll('flow-video-tile, flow-image-tile')].map(tile => {
        const rect = tile.getBoundingClientRect();
        const text = tile.innerText || tile.textContent || '';
        const sources = [...tile.querySelectorAll('video, video source, img')]
            .map(el => el.currentSrc || el.getAttribute('src') || el.getAttribute('poster') || '')
            .filter(src => /^(https?:|blob:)/i.test(src) && !/\.svg(?:[?#]|$)|placeholder|loading/i.test(src));
        const failed = /audio generation failed|failed to generate|generation failed|something went wrong|try a different prompt|you have not been charged/i.test(text)
            || !!tile.querySelector('[class*=error-tile], button[aria-label="Retry"]');
        const preview = sources.length > 0 || /play_circle|play_arrow/i.test(text)
            || !!tile.querySelector('[aria-label="Generated video thumbnail"]');
        const busy = !failed && (!preview || /(?:^|\n)\s*(?:generating|generation in progress|queued|processing|creating|\d{1,3}%)(?:\.{0,3})?\s*(?:\n|$)/i.test(text));
        return { video: tile.tagName.toLowerCase() === 'flow-video-tile', failed, busy,
            id: (sources.join(' ').match(/\/video\/([^=?/#\s]+)/) || sources.join(' ').match(/\/(?:image|asb)\/([^=?/#\s]+)/) || [])[1] || '',
            x: Math.round(left + rect.x - bounds.x), y: Math.round(top + rect.y - bounds.y), h: rect.height };
    });
    return { scrollable: !!scroller || Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) > window.innerHeight,
        top, client: scroller ? scroller.clientHeight : window.innerHeight,
        height: extent?.end ?? (scroller ? scroller.scrollHeight : Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)),
        mediaCovered:extent?.covered === true, tiles };
}

async function scanProjectMedia(page, options = {}) {
    const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const { installGridScroller, scrollGrid, wheelGrid, retryVideoLoadErrors } = require('./flow_grid_scroll');
    await page.evaluate(installGridScroller);
    const first = await page.evaluate(projectFrame);
    const records = [];
    const merge = frame => {
        for (const tile of frame.tiles) {
            const index = records.findIndex(old => (old.id && tile.id && old.id === tile.id && old.video === tile.video)
                || (old.video === tile.video && Math.abs(old.x - tile.x) < 12 && Math.abs(old.y - tile.y) < 12));
            if (index < 0) records.push(tile); else records[index] = tile;
        }
    };
    const scroll = async top => page.evaluate(scrollGrid, top);
    merge(first);
    // Offscreen mounted rows still have document positions. If they cover the
    // whole list, inventory is already complete and scrolling adds nothing.
    const positions=first.tiles.filter(t=>t.h>0).sort((a,b)=>a.y-b.y);
    const covered=first.mediaCovered || positions.length>0&&positions[0].y<=160
        &&positions.at(-1).y+positions.at(-1).h>=first.height-160
        &&positions.every((t,i)=>!i||t.y-(positions[i-1].y+positions[i-1].h)<=160);
    let exhaustive = !first.scrollable || covered;
    if (!exhaustive) {
        try {
            await scroll(0);
            await wheelGrid(page, -100000);
            await wait(700);
            let quiet = 0;
            let loadRetries = 0;
            let walked = false, clamped = 0;
            const deadline = Date.now() + 60000;
            for (let round = 0; round < 80 && Date.now() < deadline; round++) {
                if (loadRetries < 3 && await page.evaluate(retryVideoLoadErrors)) { loadRetries++; await wait(1200); }
                const frame = await page.evaluate(projectFrame);
                merge(frame);
                const before = records.length;
                const bottom = Math.max(0, frame.height - frame.client);
                const target = Math.min(bottom, frame.top + Math.max(100, frame.client * 0.75));
                await wheelGrid(page, Math.max(100, Math.floor(frame.client * 0.75)));
                for (let poll = 0; poll < (target >= bottom - 2 ? 2 : 1); poll++) {
                    await wait(750);
                    merge(await page.evaluate(projectFrame));
                    if (records.length > before) break;
                }
                const after = await page.evaluate(projectFrame);
                if (after.top > frame.top + 2) walked = true;
                const atEnd = after.top >= after.height - after.client - 2;
                quiet = records.length === before && atEnd ? quiet + 1 : 0;
                if (!atEnd && target > frame.top + 2 && after.top <= frame.top + 2) {
                    if (walked && ++clamped >= 2) break;
                    if (!walked) break;
                    await wait(1000); continue;
                }
                clamped = 0;
                if (quiet >= 2) { exhaustive = true; break; }
            }
        } finally { await scroll(first.top); }
    }
    const videos = records.filter(tile => tile.video);
    return { flow_video_tile: videos.length,
        ready_video_tile: videos.filter(tile => !tile.failed && !tile.busy).length,
        failed_video_tile: videos.filter(tile => tile.failed).length,
        generating_video_tile: videos.filter(tile => !tile.failed && tile.busy).length,
        flow_image_tile: records.length - videos.length, project_scan_complete: exhaustive };
}
// A virtualized viewport cannot prove completion. Poll it cheaply, and perform
// a full scan at most every 30 seconds or at an explicit completion gate.
function projectMonitor(scan = scanProjectMedia, now = Date.now) {
    let last = null, lastScan = -Infinity;
    return async (page, force=false) => {
        await page.evaluate(require('./flow_grid_scroll').installGridScroller);
        const frame = await page.evaluate(projectFrame);
        if (force || frame.mediaCovered || !last || now()-lastScan >= 30000) {
            last = await scan(page); lastScan = now(); return last;
        }
        const videos=frame.tiles.filter(t=>t.video);
        return {...last, project_scan_complete:false,
            failed_video_tile:Math.max(last.failed_video_tile,videos.filter(t=>t.failed).length),
            generating_video_tile:Math.max(last.generating_video_tile,videos.filter(t=>t.busy&&!t.failed).length)};
    };
}
module.exports = { scanProjectMedia, projectFrame, projectMonitor };
