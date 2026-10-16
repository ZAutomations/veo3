// Installed in the page: follow the tile ancestors rather than one Flow CSS class.
function installGridScroller() {
    window.__veoGridExtent = () => {
        const tile = document.querySelector('flow-video-tile, flow-image-tile');
        const viewport = tile?.closest('cdk-virtual-scroll-viewport');
        const spacer = viewport?.querySelector('.cdk-virtual-scroll-spacer');
        if (!spacer) return null;
        const s = window.__veoGridScroller?.();
        const bounds = s?.getBoundingClientRect() || {y:0};
        const top = s ? s.scrollTop : window.scrollY;
        const r = spacer.getBoundingClientRect();
        if (r.height <= 0) return null;
        const start = top + r.y - bounds.y, end = start + r.height;
        const rows = [...viewport.querySelectorAll('flow-video-tile, flow-image-tile')]
            .map(e => e.getBoundingClientRect()).filter(r => r.height > 0)
            .map(r => ({start:top+r.y-bounds.y,end:top+r.bottom-bounds.y})).sort((a,b)=>a.start-b.start);
        let through = start, covered = rows.length > 0;
        for (const row of rows) {
            if (row.start > through + 40) {covered=false;break;}
            through = Math.max(through, row.end);
        }
        return {start,end,covered:covered && through >= end-4};
    };
    window.__veoGridScroller = () => {
        const tiles = [...document.querySelectorAll('flow-video-tile, flow-image-tile')];
        const votes = new Map();
        for (const tile of tiles) {
            for (let el = tile.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
                const r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0 || el.clientHeight < 80 || el.scrollHeight <= el.clientHeight + 2) continue;
                if (!/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY)) continue;
                votes.set(el, (votes.get(el) || 0) + 1);
                break;
            }
        }
        return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    };
}
function gridMetrics() {
    const s = window.__veoGridScroller?.();
    const extent = window.__veoGridExtent?.();
    return { top: s ? s.scrollTop : window.scrollY, client: s ? s.clientHeight : window.innerHeight,
        scroll: s ? s.scrollHeight : Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        mediaEnd:extent?.end, mediaCovered:extent?.covered === true,
        tag: s ? `${s.tagName}.${String(s.className || '')}` : 'window' };
}
function scrollGrid(y) {
    const s = window.__veoGridScroller?.();
    if (s) { s.scrollTop = y; s.dispatchEvent(new Event('scroll', { bubbles: true })); }
    else window.scrollTo(0, y);
}
// Flow's CDK grid can listen on an outer scroll host while a nested container
// also accepts scrollTop. Wheel input follows Chrome's actual scroll chain and
// triggers loading/virtualization on the same host used by a person.
async function wheelGrid(page, delta) {
    const point = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll('flow-video-tile, flow-image-tile')];
        const tile = tiles.find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 160 && r.top < innerHeight - 80; });
        const rect = tile?.getBoundingClientRect();
        if (rect) return { x: Math.max(10, Math.min(innerWidth - 10, rect.left + rect.width / 2)), y: Math.max(180, Math.min(innerHeight - 100, rect.top + rect.height / 2)) };
        const s = window.__veoGridScroller?.();
        const r = s?.getBoundingClientRect();
        return { x: r ? Math.max(20, Math.min(innerWidth - 20, r.left + Math.min(r.width / 2, 300))) : innerWidth / 2,
            y: Math.max(180, Math.min(innerHeight - 100, r ? r.top + r.height / 2 : innerHeight / 2)) };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel({ deltaY: delta });
}
// Playback-load Retry reloads existing media, never a generation-failure retry.
function retryVideoLoadErrors() {
    let clicked = 0;
    for (const button of document.querySelectorAll('button')) {
        if (!/^retry$/i.test(button.getAttribute('aria-label') || button.innerText || '')) continue;
        let parent = button.parentElement;
        for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
            const text = parent.innerText || parent.textContent || '';
            if (/generation failed|failed to generate|not been charged/i.test(text)) break;
            if (/the video failed to load\.?/i.test(text)) {
                const rect = parent.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && !button.disabled) { button.click(); clicked++; }
                break;
            }
        }
    }
    return clicked;
}
module.exports = { installGridScroller, gridMetrics, scrollGrid, wheelGrid, retryVideoLoadErrors };
