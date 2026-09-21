// show_config.js - print the selector/timing config the engine will actually use.
//
//   node show_config.js
//
// Use it after editing selectors.json to confirm the value took, and to see
// which layer each group came from.

const rc = require('./remote_config.js');

const cfg = rc.load();

console.log(`\nEffective config  (sources: ${cfg.sources.join(' -> ')})\n`);
for (const group of ['selectors', 'patterns', 'timings']) {
    console.log(`${group}:`);
    for (const [k, v] of Object.entries(cfg[group] || {})) {
        if (k.startsWith('_')) continue;
        const shown = typeof v === 'string' && v.length > 70 ? `${v.slice(0, 67)}...` : v;
        console.log(`  ${k.padEnd(28)} ${shown}`);
    }
    console.log('');
}

try {
    rc.compilePatterns(cfg);
    console.log('patterns compile OK');
} catch (e) {
    console.log(`PROBLEM: ${e.message}`);
    process.exitCode = 1;
}
console.log(`local override file: ${rc.LOCAL_FILE}\n`);
