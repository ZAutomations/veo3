const assert=require('assert'),fs=require('fs'),vm=require('vm');
const code=fs.readFileSync(require.resolve('../mcp_server'),'utf8');
const fn=code.match(/function tailOf\(s, n = 240\) \{[\s\S]*?\n\}/)[0];
const tail=vm.runInNewContext('('+fn+')');
const result=tail('Earlier output. RECOVERY_REVIEW_REQUIRED: CLIP_DURATION_MISMATCH: '+Array(40).fill('scene expected 10s actual 4s').join('; '));
assert(result.startsWith('RECOVERY_REVIEW_REQUIRED: CLIP_DURATION_MISMATCH:'));
assert(result.length<=240);assert.equal(tail('ordinary output'),'ordinary output');
console.log('PASS: long duration/review errors retain the review marker so automatic retry cannot lose the stop signal.');

assert(tail('Earlier RECOVERY_REVIEW_REQUIRED: SCENE_NAMING_FAILED: deferred\nDOWNLOAD FAILED: No completed thumbnail appeared').includes('DOWNLOAD FAILED: No completed thumbnail appeared'));
