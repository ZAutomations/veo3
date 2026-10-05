// Tests for the analysis-resilience layer in mcp_server.js.
//
// The user's failing run died with twelve API keys configured, twenty minutes
// spent, and a perfectly good plan to throw away: the batch layer had no retry,
// and it re-analysed a video it had already read. These cover the two fixes -
// the content-map cache and the retry wiring.
//
// Reuse is checked against a real call (no network, no credits - a cache hit
// spawns nothing), and the retry loop is asserted against the source because
// exercising it for real would mean a live Gemini call.
//
// Run: node test_analyze_resilience.js     (no network, spends nothing)
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('./mcp_server.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 220) : ''}`); }
}

const src = fs.readFileSync(path.join(__dirname, 'mcp_server.js'), 'utf8');

(async () => {
console.log('\n--- the server is import-safe now ---');
ok('requiring it does not start a stdio server', typeof M.cachedMapForReference === 'function');
ok('the boot is behind require.main', /if \(require\.main === module\) \{/.test(src));
ok('TOOLS came through', Array.isArray(M.TOOLS) && M.TOOLS.length > 5, String(M.TOOLS && M.TOOLS.length));
ok('doAnalyzeVideo is reachable for tests', typeof M.doAnalyzeVideo === 'function');
ok('the analysis timeout covers the retry plus the fallback',
    M.ANALYZE_TIMEOUT_MS >= 25 * 60 * 1000, String(M.ANALYZE_TIMEOUT_MS));

// ── the cache lookup ────────────────────────────────────────────────────────
console.log('\n--- cachedMapForReference: same link, same clip length ---');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-cache-'));
const URL_A = 'https://www.youtube.com/shorts/AAAA';
const URL_B = 'https://www.youtube.com/shorts/BBBB';
function writeMap(slug, url, seconds, extra) {
    const cm = Object.assign({
        source_url: url,
        title_suggestion: 'A Title',
        format: { clip_seconds: seconds, source_duration_s: 110 },
        clips: [{ index: 1 }, { index: 2 }],
        facts: [{ t: '0:02', places: ['X'], detail: 'd' }],
    }, extra || {});
    fs.writeFileSync(path.join(tmp, `${slug}.content-map.json`), JSON.stringify(cm));
    return cm;
}
writeMap('map_eight', URL_A, 8);
writeMap('map_four', URL_B, 4);
fs.writeFileSync(path.join(tmp, 'map_eight.detail.txt'), 'Genre: x.\nBeats:\n1. a\n');
// Noise the lookup must ignore rather than trip over.
fs.writeFileSync(path.join(tmp, 'notes.json'), JSON.stringify({ source_url: URL_A }));
fs.writeFileSync(path.join(tmp, 'broken.content-map.json'), '{not json');
fs.mkdirSync(path.join(tmp, 'a_dir.content-map.json'));

const hitA = M.cachedMapForReference(URL_A, 8, tmp);
ok('finds the map for a link', hitA && hitA.cm.source_url === URL_A);
ok('returns the file it lives in', hitA && hitA.file.endsWith('map_eight.content-map.json'), hitA && hitA.file);
ok('and the detail file beside it', hitA && hitA.detail && hitA.detail.endsWith('map_eight.detail.txt'));
ok('a link with no map returns null', M.cachedMapForReference('https://x/none', 8, tmp) === null);
ok('a missing folder is not an error', M.cachedMapForReference(URL_A, 8, path.join(tmp, 'nope')) === null);
ok('a malformed map is skipped, not thrown', !!M.cachedMapForReference(URL_A, 0, tmp));
ok('YouTube shorts and watch links have the same identity',
    M.referenceKey(URL_A) === M.referenceKey('https://youtube.com/watch?v=AAAA&utm_source=x'));
ok('a youtu.be spelling finds the same saved analysis',
    !!M.cachedMapForReference('https://youtu.be/AAAA?t=4', 8, tmp));

const storiesTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-stories-'));
const savedStoryDir = path.join(storiesTmp, 'a_title');
const savedStory = path.join(savedStoryDir, 'a_title_story.json');
fs.mkdirSync(savedStoryDir, { recursive: true });
fs.writeFileSync(savedStory, JSON.stringify({ title: 'A Title', total_scenes: 3, scene_seconds: 8 }));
// A stopped later attempt left a newer analysis under a different title but no
// story. This is the real failure shape: lookup must not stop at that map.
writeMap('newer_attempt_without_story', URL_A, 8, { title_suggestion: 'No Story Yet' });
const newerMap = path.join(tmp, 'newer_attempt_without_story.content-map.json');
const future = new Date(Date.now() + 5000);
fs.utimesSync(newerMap, future, future);
ok('the cache prefers the newest analysis when several maps share one link',
    M.cachedMapForReference(URL_A, 8, tmp).file === newerMap);
ok('a URL variant resolves all the way to its already-written story',
    M.storyForReference('https://youtube.com/watch?v=AAAA', tmp, storiesTmp) === savedStory);

console.log('\n--- clip length is what makes a map valid ---');
// clip_seconds decides the map's clip boundaries, so an 8s map does not
// describe a 4s film - serving it would silently mis-time every scene.
ok('asking for a different clip length misses',
    M.cachedMapForReference(URL_A, 4, tmp) === null);
ok('0 accepts any length', !!M.cachedMapForReference(URL_B, 0, tmp));
ok('the 4s map is found for 4s', !!M.cachedMapForReference(URL_B, 4, tmp));
ok('a map with no clip_seconds still matches (cannot know its length)',
    (() => {
        fs.writeFileSync(path.join(tmp, 'nolength.content-map.json'),
            JSON.stringify({ source_url: 'https://x/nolen', format: {} }));
        return !!M.cachedMapForReference('https://x/nolen', 8, tmp);
    })());

console.log('\n--- the old two-arg call still behaves ---');
ok('contentMapForReference returns the map alone',
    M.contentMapForReference(URL_A) === null || !!M.contentMapForReference(URL_A));
ok('and it is a pure pass-through of the cache', /return hit \? hit\.cm : null;/.test(src));

// ── reuse actually short-circuits the work ──────────────────────────────────
console.log('\n--- a repeated link is not analysed twice ---');
// A real end-to-end call. It is safe because a cache hit spawns nothing: no
// node process, no Gemini call, no credits.
const REF = path.join(__dirname, 'stories', '_reference');
const PROBE = 'https://www.youtube.com/shorts/__offline_probe_only__';
const probeFile = path.join(REF, '__probe__.content-map.json');
let probed = false;
try {
    fs.mkdirSync(REF, { recursive: true });
    fs.writeFileSync(probeFile, JSON.stringify({
        source_url: PROBE,
        title_suggestion: 'Probe',
        format: { clip_seconds: 8 },
        clips: [{ index: 1 }],
        facts: [{ t: '0:01', places: ['Probe'], detail: 'a probe' }],
    }));
    const t0 = Date.now();
    const r = await M.doAnalyzeVideo({ url: PROBE, seconds: 8 });
    const ms = Date.now() - t0;
    probed = true;
    ok('the call succeeds from the cache', r.ok === true, r.text.slice(0, 160));
    ok('and is flagged as reused', r.reused === true);
    ok('it returns the cached map path', r.contentMap === probeFile, String(r.contentMap));
    ok('without spawning anything (it returns at once)', ms < 4000, `${ms}ms`);
    ok('and says so in the text', /Reusing the analysis already on disk/.test(r.text), r.text.slice(0, 160));

    // reuse:false must NOT serve the cache. Asserted against the source rather
    // than called: a real call would spawn analyze_video.js and reach Gemini,
    // and this file is meant to spend nothing.
    ok('reuse:false is not answered from the cache', /if \(a\.reuse !== false\) \{/.test(src));
    ok('and that guard wraps the whole cache block',
        src.indexOf("if (a.reuse !== false) {") < src.indexOf('const hit = cachedMapForReference(url, a.seconds)'),
        'guard precedes the lookup');
} finally {
    try { fs.unlinkSync(probeFile); } catch (e) { /* not there */ }
}
ok('the probe did not leave a file behind', !fs.existsSync(probeFile));
ok('(the probe ran)', probed);

console.log('\n--- Generate batch preserves a finished story ---');
ok('reuse assigns the written story directly',
    /storyArg = cand;[\s\S]{0,300}analyse and write skipped/.test(src));
ok('only explicit reuse:false enables an overwrite', /let rewrite = a\.reuse === false;/.test(src));
ok('duration mismatch no longer triggers a silent rewrite',
    !/existing story is \$\{have\}s, this run wants \$\{want\}s - rewriting/.test(src));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
try { fs.rmSync(storiesTmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }

// ── the retry loop ──────────────────────────────────────────────────────────
console.log('\n--- one failure no longer kills the item ---');
ok('the analyse step retries', /const tries = a\.analyze_tries === undefined \? 2/.test(src));
ok('it is capped at three attempts', /Math\.min\(3, Number\(a\.analyze_tries\)/.test(src));
ok('it pauses before the second attempt', /retrying in 20s/.test(src));
ok('it stops as soon as one attempt succeeds', /if \(r\.code === 0\) break;/.test(src));
ok('it is exposed to the caller', /analyze_tries: \{ type: 'integer'/.test(src));

console.log('\n--- the batch can control the spike budget ---');
ok('the budget is exposed on batch_pipeline', /analyze_wait: \{ type: 'integer'/.test(src));
ok('and on full_pipeline', (src.match(/analyze_wait: \{ type: 'integer'/g) || []).length === 2,
    String((src.match(/analyze_wait: \{ type: 'integer'/g) || []).length));
ok('the download fallback can be switched off per batch', /analyze_download: \{ type: 'boolean'/.test(src));
// The collision this avoids: batch_pipeline's `wait` is the per-image wait and
// its `download` means downloading the finished clips. Passing those through
// would silently set the analysis budget to 180s and disable the fallback.
ok('the analyse budget is NOT wired to the batch\'s own `wait`',
    !/wait: a\.wait, analyze_tries/.test(src));
ok('the fallback is NOT wired to the batch\'s own `download`',
    !/download: a\.download, reuse/.test(src));
ok('both call sites pass the namespaced names',
    (src.match(/wait: a\.analyze_wait, analyze_tries: a\.analyze_tries/g) || []).length === 2,
    String((src.match(/wait: a\.analyze_wait/g) || []).length));
ok('analyze_video.js is given the budget flag', /pushOpt\(args, '--wait', a\.wait\)/.test(src));
ok('and the download opt-out', /if \(a\.download === false\) args\.push\('--no-download'\)/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error('FAILED: ' + (e && e.stack || e));
    process.exit(1);
});
