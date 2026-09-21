// Tests for project_setup.js - the Agent Mode pre-step that gives each film its
// own Flow project.
//
// The create step needs a live Chrome, so this covers the pure helpers and the
// CLI's refusal to run without a browser. No network, no browser.
//
// Run: node test_project_setup.js
const path = require('path');
const { execFileSync } = require('child_process');
const P = require('./project_setup.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + String(extra).slice(0, 220) : ''}`); }
}

console.log('\n--- projectIdFromUrl ---');
const id = 'ab12cd34-ef56-7890-abcd-1234567890ef';
ok('reads the id from a project home',
    P.projectIdFromUrl(`https://flow.google.com/project/${id}`) === id);
ok('reads it from a trailing slash', P.projectIdFromUrl(`https://flow.google.com/project/${id}/`) === id);
ok('blank for the project grid', P.projectIdFromUrl('https://flow.google.com/') === '');
ok('blank for anything else', P.projectIdFromUrl('https://example.com/x') === '');
ok('blank for null', P.projectIdFromUrl(null) === '');

console.log('\n--- chooseNewProject ---');
ok('picks the largest visible match',
    P.chooseNewProject([
        { label: 'Create', area: 100, visible: true },
        { label: 'New project', area: 5000, visible: true },
    ]) === 'New project');
ok('ignores hidden controls',
    P.chooseNewProject([
        { label: 'New project', area: 9000, visible: false },
        { label: 'Create', area: 10, visible: true },
    ]) === 'Create');
ok('ignores a non-matching control', P.chooseNewProject([{ label: 'Settings', area: 9000, visible: true }]) === null);
ok('tolerates an empty list', P.chooseNewProject([]) === null);
ok('tolerates undefined', P.chooseNewProject(undefined) === null);
ok('matches "Create project" too',
    P.chooseNewProject([{ label: 'Create project', area: 50, visible: true }]) === 'Create project');

console.log('\n--- the CLI fails cleanly with no browser ---');
// A dead CDP port so it can never touch a real Chrome during the test.
let code = 0, err = '';
try {
    execFileSync(process.execPath, [path.join(__dirname, 'project_setup.js'), '--cdp', '59999'],
        { encoding: 'utf8', stdio: 'pipe', timeout: 25000 });
} catch (e) { code = e.status; err = String(e.stderr || ''); }
ok('a dead CDP port exits non-zero', code !== 0 && code !== null, String(code));
ok('and tells you to start the browser',
    /Start the automation browser|Could not connect/i.test(err), err.slice(0, 180));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
