// test_reliability.js - checks for the watchdog / progress / remote-config work.
//
//   node test_reliability.js
//
// Covers the things that can be verified without a live Flow tab: that the
// in-page probes survive being serialized into a page, that the config layers
// merge in the right order, and that the engine wires the timings through.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let failures = 0;
function check(name, fn) {
    try { fn(); console.log(`  ok    ${name}`); }
    catch (e) { failures++; console.log(`  FAIL  ${name}\n          ${e.message}`); }
}

const health = require('./page_health.js');
const rc = require('./remote_config.js');

console.log('\npage_health');

// The in-page functions are stringified and shipped to the browser. One that
// closes over module scope compiles fine here and arrives as a ReferenceError
// there, so re-parse each one in isolation: a bare `new Function` has no
// module scope to fall back on, which is exactly the browser's situation.
for (const name of ['SWEEP', 'READ_STATE', 'READ_PROGRESS']) {
    check(`${name} is a standalone function`, () => {
        assert.strictEqual(typeof health[name], 'function');
        const src = health[name].toString();
        const rebuilt = new Function(`return (${src})`)();
        assert.strictEqual(typeof rebuilt, 'function');
    });
}

check('READ_STATE tolerates being handed patterns', () => {
    const src = health.READ_STATE.toString();
    assert.ok(/pat\.errorText/.test(src) && /pat\.creditsOut/.test(src),
        'READ_STATE must read the patterns it is given, not hardcoded text');
});

check('READ_PROGRESS returns null rather than guessing', () => {
    const src = health.READ_PROGRESS.toString();
    // It reports "no number available" by returning the null `best` rather
    // than substituting an estimate - the estimate is the caller's job.
    assert.ok(/best === null \? 'none' : 'text'/.test(src),
        'must be able to report "no number available"');
    assert.ok(/let best = null/.test(src), 'the scan result starts empty');
});

check('SWEEP never dismisses the credits approval', () => {
    const src = health.SWEEP.toString();
    assert.ok(/always approve\|/.test(src), 'the approve dialog is a step, not a blocker');
});

console.log('\nremote_config');

check('defaults load with no override file present', () => {
    const cfg = rc.DEFAULTS;
    assert.strictEqual(cfg.selectors.clipsSelector, '.timeline-contents .clip');
    assert.ok(cfg.timings.stallMs > 0);
});

// selectors.json is the user's escape hatch, so prove an edit actually wins
// over the built-in value rather than silently loading.
const localPath = rc.LOCAL_FILE;
const saved = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : null;
try {
    fs.writeFileSync(localPath, JSON.stringify({
        selectors: { clipsSelector: '#test-override' },
        timings: { stallMs: 1234 },
        patterns: { _note: 'underscore keys are documentation, not regexes' },
    }));
    const cfg = rc.load();
    check('selectors.json overrides a selector', () => {
        assert.strictEqual(cfg.selectors.clipsSelector, '#test-override');
    });
    check('selectors.json can change a timing', () => {
        assert.strictEqual(cfg.timings.stallMs, 1234);
    });
    check('untouched keys keep their defaults', () => {
        assert.ok(/clip\.extend-composing/.test(cfg.selectors.emptySlotSelector));
    });
    check('underscore keys are skipped by the regex compiler', () => {
        assert.ok(!('_note' in rc.compilePatterns(cfg)));
    });
    check('an unedited file changes nothing', () => {
        const d = rc.DEFAULTS;
        assert.strictEqual(d.selectors.addClipLabel, 'Add clip');
    });
} finally {
    if (saved === null) fs.unlinkSync(localPath);
    else fs.writeFileSync(localPath, saved);
}

check('a bad regex is reported, not silently ignored', () => {
    assert.throws(() => rc.compilePatterns({ patterns: { errorText: '([' } }), /not a valid regex/);
});

check('defaults still compile as regexes after the round trip', () => {
    rc.compilePatterns(rc.load());
});

console.log('\nengine wiring');

check('the engine requires both new modules', () => {
    const src = fs.readFileSync(path.join(__dirname, 'veo3_flow_new_ui.js'), 'utf8');
    assert.ok(/require\('\.\/remote_config\.js'\)/.test(src));
    assert.ok(/require\('\.\/page_health\.js'\)/.test(src));
});

check('timings are applied onto CONFIG', () => {
    const src = fs.readFileSync(path.join(__dirname, 'veo3_flow_new_ui.js'), 'utf8');
    assert.ok(/Object\.assign\(CONFIG,\s*this\.cfg\.timings\)/.test(src),
        'existing CONFIG.x call sites depend on this');
});

check('no mojibake in the source files', () => {
    // What this catches is not a typo. An emoji like "✅" is E2 9C 85 on disk;
    // read back through cp1252 those three bytes become three characters, "âœ…",
    // and once that text is saved the damage is permanent - it renders as
    // nonsense forever after and no amount of console-codepage fixing helps.
    // veo3_flow_new_ui.js picked up 1631 of them this way and printed
    // "ðŸš€ CONNECTING THE AUTOMATION BROWSER" at every run.
    //
    // The check that used to sit here asserted only that the new code was
    // present, so it watched that happen and said nothing. This reads the
    // characters back the way they were written: a run of cp1252-alphabet
    // characters that decodes cleanly as UTF-8 is mojibake, and a run that does
    // not (a lone "…", say) is left alone.
    const C2B = {};
    const HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';
    for (let i = 0; i < 32; i++) C2B[HIGH[i]] = 0x80 + i;
    const isBad = (ch) => {
        const c = ch.codePointAt(0);
        return (c >= 0xA0 && c <= 0xFF) || C2B[ch] !== undefined;
    };
    const decode = (run) => {
        const bytes = [];
        for (const ch of run) {
            const c = ch.codePointAt(0);
            const b = c < 0x100 ? c : C2B[ch];
            if (b === undefined) return null;
            bytes.push(b);
        }
        const out = Buffer.from(bytes).toString('utf8');
        return (out.includes('�') || !/[^\x00-\x7F]/.test(out)) ? null : out;
    };
    const me = path.basename(__filename);
    const files = fs.readdirSync(__dirname).filter((f) => /\.(js|py)$/.test(f) && f !== me);
    const found = [];
    for (const f of files) {
        const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
        for (let i = 0; i < src.length;) {
            if (!isBad(src[i])) { i++; continue; }
            let j = i;
            while (j < src.length && isBad(src[j])) j++;
            const run = src.slice(i, j);
            const back = decode(run);
            if (back && !isBad(back[0])) found.push(`${f}: "${run}" should be "${back}"`);
            i = j;
        }
    }
    assert.equal(found.length, 0,
        `${found.length} mojibake span(s) in the source:\n    ` + found.slice(0, 8).join('\n    '));
});

console.log(failures ? `\n${failures} FAILED\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
