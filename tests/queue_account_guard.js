const assert=require('assert'),{ensureAccount}=require('../queue_account');
(async()=>{
 const store={current:0,browser:'A',accounts:[{label:'A',clips_used:0,max_clips:100},{label:'B',clips_used:0,max_clips:100}]};let switches=[];
 const api={load:()=>store,findAccount:(s,n)=>s.accounts.find(a=>a.label===n),ensureMonthly:()=>{},cdpAlive:async()=>true,switchBrowser:async n=>{switches.push(n);store.current=store.accounts.findIndex(a=>a.label===n);store.browser=n;return true;}};
 await ensureAccount('A',9222,api);await ensureAccount('B',9222,api);await ensureAccount('B',9222,api);assert.deepEqual(switches,['B']);
 store.accounts[0].paused=true;await assert.rejects(()=>ensureAccount('A',9222,api),/unavailable/);assert.deepEqual(switches,['B']);
 console.log('PASS: assigned-account guard is idempotent, switches only to its planned account, and never substitutes a paused account.');
})().catch(e=>{console.error(e);process.exitCode=1});
