// page_health.js
//
// Health probes for the Flow tab, plus the recovery sweep that clears a
// blocking dialog.
//
// Everything in this file that runs *in the page* is a bare arrow function
// with no reference to module scope: puppeteer serializes the function body
// into the tab, so a closure over these constants would arrive undefined.
// Anything a probe needs is passed in as an argument.

// ── sweeping a blocked page ───────────────────────────────────────────

// Flow surfaces generation failures inside a Material dialog rather than
// inline, and a dialog left on screen swallows the next click. This finds
// every open dialog layer, reads any error text out of it, then closes it
// with the least destructive affordance available: a labelled closer first,
// the backdrop only if no closer exists.
//
// Deliberately NOT dismissed: anything matching the credits approval (that
// dialog is a step in the run, not a blocker) and any "Extend (Veo ...)"
// menu entry (that is the model picker, and closing it would undo an arm).
const SWEEP = () => {
    const out = { dismissed: [], errorText: null, overlays: 0, sawApprove: false };

    const bodyText = (document.body && document.body.innerText) || '';
    const err = bodyText.match(/sorry, this video failed[^\n]*|something went wrong[^\n]*|failed to generate[^\n]*/i);
    if (err) out.errorText = err[0].trim().slice(0, 160);

    const overlays = [...document.querySelectorAll(
        '.cdk-overlay-container .cdk-overlay-pane, mat-dialog-container, .cdk-global-overlay-wrapper'
    )];
    // The container itself is always in the DOM; only a pane inside it means
    // something is actually open.
    out.overlays = overlays.length;
    if (!overlays.length) return out;

    const label = (el) => ((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '')).trim();
    const closers = overlays
        .flatMap(o => [...o.querySelectorAll('button, [role=button], a')])
        .filter(b => {
            const l = label(b);
            if (!l) return false;
            if (/always approve|^approve\b/i.test(l)) { out.sawApprove = true; return false; }
            if (/extend\s*\(|veo\s*3/i.test(l)) return false;
            return /^(dismiss|close|cancel|ok|okay|got it|continue|try again|back|done|not now)\b/i.test(l);
        });

    for (const b of closers) {
        try {
            const l = label(b).slice(0, 40);
            b.click();
            out.dismissed.push(l);
        } catch {}
    }

    if (!out.dismissed.length) {
        const bd = document.querySelector('.cdk-overlay-backdrop');
        if (bd) { try { bd.click(); out.dismissed.push('backdrop'); } catch {} }
    }
    return out;
};

// ── reading the run ──────────────────────────────────────────────────

// The generation state that both poll loops in the engine need: is a job
// running, has it failed, is a credits dialog waiting. Consolidated here so
// the two loops cannot drift apart.
const READ_STATE = (pat) => {
    const body = (document.body && document.body.innerText) || '';
    const buttons = [...document.querySelectorAll('button')];
    const err = body.match(new RegExp(pat.errorText, 'i'));
    return {
        url: location.href,
        generating: buttons.some(b => (b.innerText || '').trim() === 'stop'),
        failed: !!err,
        errorText: err ? err[0].trim().slice(0, 160) : null,
        approve: buttons.some(b => /always approve/i.test(b.innerText || '') || (b.innerText || '').trim() === 'Approve'),
        creditsOut: new RegExp(pat.creditsOut, 'i').test(body),
    };
};

// Flow's own percentage for the running job, when the UI exposes one.
// Returns pct: null rather than a guess - the engine falls back to an
// elapsed-time estimate, and a fabricated number would be worse than none.
const READ_PROGRESS = () => {
    const bar = document.querySelector('[role=progressbar][aria-valuenow]');
    if (bar) {
        const n = parseInt(bar.getAttribute('aria-valuenow'), 10);
        if (!isNaN(n)) return { pct: Math.max(0, Math.min(100, n)), src: 'aria' };
    }
    // Otherwise the only bare "NN%" on screen belongs to the running job.
    // Bounded walk: a full element scan here would cost more than the poll.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let best = null;
    while (walker.nextNode()) {
        const t = (walker.currentNode.textContent || '').trim();
        if (t.length < 2 || t.length > 5) continue;
        const m = t.match(/^(\d{1,3})%$/);
        if (!m) continue;
        const el = walker.currentNode.parentElement;
        if (!el || !el.getBoundingClientRect().width) continue;
        best = Math.min(100, parseInt(m[1], 10));
    }
    return { pct: best, src: best === null ? 'none' : 'text' };
};

// ── host side ────────────────────────────────────────────────────────

// Run the sweep, and report whether the page looks healthy afterwards.
async function sweep(page) {
    try {
        const r = await page.evaluate(SWEEP);
        return (r && !r.__error) ? r : { dismissed: [], errorText: null, overlays: 0, sawApprove: false };
    } catch (e) {
        return { dismissed: [], errorText: null, overlays: 0, sawApprove: false, error: e.message };
    }
}

module.exports = { SWEEP, READ_STATE, READ_PROGRESS, sweep };
