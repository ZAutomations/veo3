const assert=require('assert'),{reorderStore}=require('../account_manager');
const s={current:0,browser:'A',accounts:[{label:'A',profile:'a',clips_used:4},{label:'B',profile:'b'},{label:'C',profile:'c'}]};
const a=s.accounts[0];reorderStore(s,'A','down');assert.deepEqual(s.accounts.map(a=>a.label),['B','A','C']);assert.equal(s.current,1);assert.strictEqual(s.accounts[s.current],a);assert.equal(s.browser,'A');
reorderStore(s,'A','down');assert.deepEqual(s.accounts.map(a=>a.label),['B','C','A']);assert.equal(s.current,2);assert.equal(a.clips_used,4);
reorderStore(s,'A','down');assert.equal(s.current,2);
reorderStore(s,'C','up');assert.deepEqual(s.accounts.map(a=>a.label),['C','B','A']);assert.equal(s.current,2);
assert.throws(()=>reorderStore(s,'missing','up'));assert.throws(()=>reorderStore(s,'A','left'));
console.log('PASS: move up/down reorders accounts, preserves identity/usage/current browser, and handles list boundaries.');
