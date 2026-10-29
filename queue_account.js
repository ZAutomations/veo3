// Fixed queue allocation, never an error-triggered failover.
const manager=require('./account_manager');
async function ensureAccount(label,port,api=manager){
 const store=api.load(),acc=api.findAccount(store,label);
 if(!acc||acc.paused||acc.restricted||acc.blocked)throw Error('FLOW_REVIEW_REQUIRED: Assigned queue account is unavailable. No alternate account selected.');
 api.ensureMonthly(acc);
 if(acc.clips_used>=acc.max_clips)throw Error('FLOW_REVIEW_REQUIRED: Assigned queue account has no remaining clips. No alternate account selected.');
 if(store.accounts[store.current]?.label===acc.label&&store.browser===acc.label&&await api.cdpAlive(port)){
  console.log(`QUEUE ACCOUNT: ${acc.label}; keeping the existing browser.`);return;
 }
 console.log(`QUEUE ACCOUNT: opening assigned profile ${acc.label} for the next story. Earlier story operations completed before this step.`);
 if(!await api.switchBrowser(acc.label,port,true))throw Error('FLOW_REVIEW_REQUIRED: Assigned queue account browser could not start. No alternate account selected.');
}
if(require.main===module){const flag=n=>process.argv[process.argv.indexOf(n)+1];ensureAccount(flag('--label'),Number(flag('--cdp')||9222)).catch(e=>{console.error(e.message);process.exitCode=2;});}
module.exports={ensureAccount};
