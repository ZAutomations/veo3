// Actual Flow balance snapshots. Never estimate spend or add daily/monthly allowances.
'use strict';
const manager=require('./account_manager');
function parseCount(text){
 const m=String(text||'').replace(/\u00a0/g,' ').trim().match(/^([\d][\d,\s]*)\s+(?:Google\s+Flow|AI)\s+credits?$/i);
 if(!m)return null;
 const n=Number(m[1].replace(/[,\s]/g,''));return Number.isSafeInteger(n)&&n>=0?n:null;
}
function readPanel(){
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 return [...document.querySelectorAll('.credits-count')].filter(visible).map(e=>({text:e.textContent.trim(),href:e.closest('a.credits-link')?.href||''}));
}
function selectReading(rows,expectedEmail){
 const readings=rows.map(r=>{let email='';try{email=new URL(r.href).searchParams.get('Email')||new URL(r.href).searchParams.get('email')||'';}catch{}return {...r,balance:parseCount(r.text),email:email.toLowerCase()};}).filter(r=>r.balance!==null);
 const expected=String(expectedEmail||'').trim().toLowerCase();
 if(!expected)throw Error('Save the Google email for this account before syncing its balance.');
 const own=readings.filter(r=>r.email===expected);
 if(readings.length&&!readings.some(r=>r.email))throw Error('Flow credit account identity is still loading.');
 if(!own.length)throw Error(readings.length?'Flow account email does not match the saved account; balance was not changed.':'Flow credit balance is not visible. Sign in to the active profile and retry.');
 if(new Set(own.map(r=>r.balance)).size!==1)throw Error('Multiple different credit balances are visible; no balance saved.');
 return {balance:own[0].balance,email:expected};
}
function storeReading(store,label,reading,now=new Date().toISOString()){
 const acc=manager.findAccount(store,label);if(!acc)throw Error('Saved account no longer exists.');
 if(String(acc.email||'').trim().toLowerCase()!==reading.email)throw Error('Account identity changed during refresh.');
 const previous=acc.flow_credits?.remaining;
 acc.flow_credits={remaining:reading.balance,updated_at:now,checked_at:now,status:'verified',source:'Flow profile',balance_change:Number.isInteger(previous)?reading.balance-previous:null,error:null};
 return acc.flow_credits;
}
async function refreshActive({port=9222,label='',api=manager,connect,openBrowser=false}={}){
 const start=api.load(),acc=start.accounts[start.current];
 if(!acc||start.browser!==acc.label||label&&label!==acc.label)throw Error('Activate this account first. Credit refresh never switches accounts.');
 if(!acc.email)throw Error('This account needs its saved Google email to verify its Flow balance.');
 let browser,page;
 try{
  const attach=()=> (connect||require('puppeteer').connect)({browserURL:`http://127.0.0.1:${port}`});
  try{browser=await attach();}catch(error){
   if(!openBrowser)throw Error(`Automation browser is not available on port ${port}. Use Refresh credits to open the active saved profile.`);
   if(await api.cdpAlive(port))throw Error(`Browser port ${port} is answering but could not be attached; no browser was closed or switched.`);
   const fresh=api.load();
   if(fresh.accounts[fresh.current]?.label!==acc.label||fresh.browser!==acc.label)throw Error('Active account changed; browser was not opened.');
   console.log(`FLOW CREDITS: opening the active saved profile on port ${port}...`);
   if(!await api.launchBrowser(acc,port,{waitMs:15000}))throw Error('Could not open the active automation profile. If its sign-in window is already open, close that profile window and use Make active, then retry.');
   browser=await attach();
  }
  // Dedicated temporary tab: never touch the generation composer or account selection.
  page=await browser.newPage();
  try{await page.goto('https://flow.google.com/',{waitUntil:'domcontentloaded',timeout:30000});}
  catch(error){if(error.name!=='TimeoutError'&&!/Navigation timeout/i.test(error.message))throw error;console.log('FLOW CREDITS: Flow is still loading; checking its credit panel before giving up...');}
  const until=Date.now()+20000;let opened=false,previous=null,reading=null,lastError=null;
  while(Date.now()<until){
   let rows;
   try{rows=await page.evaluate(readPanel);}catch(error){if(!/execution context|cannot find context|navigation|detached/i.test(error.message))throw error;await new Promise(r=>setTimeout(r,350));continue;}
   try{
    const candidate=selectReading(rows,acc.email);
    if(previous&&candidate.balance===previous.balance&&candidate.email===previous.email){reading=candidate;break;}
    previous=candidate;
   }catch(error){lastError=error;previous=null;}
   // The count can render before its AccountChooser Email link hydrates.
   // Never accept a visible count alone, and never misreport that transient row as another account.
   if(!opened&&!previous){const chip=await page.$('.tier-chip');if(chip){await chip.click();opened=true;}}
   await new Promise(r=>setTimeout(r,350));
  }
  if(!reading)throw lastError||Error('Flow credit balance/account did not settle; retry refresh.');
  const fresh=api.load();
  if(fresh.accounts[fresh.current]?.label!==acc.label||fresh.browser!==acc.label)throw Error('Active browser account changed while reading credits; no balance saved.');
  const result=storeReading(fresh,acc.label,reading);api.save(fresh);return result;
 }catch(error){
  const fresh=api.load(),a=api.findAccount(fresh,acc.label);
  if(a){a.flow_credits={...(a.flow_credits||{}),status:'stale',checked_at:new Date().toISOString(),error:'Credit refresh unavailable; activate/sign in to this saved account and retry.'};api.save(fresh);}
  throw error;
 }finally{if(page)await page.close().catch(()=>{});if(browser)await browser.disconnect();}
}
if(require.main===module){
 const arg=(name,def)=>{const n=process.argv.indexOf(name);return n<0?def:process.argv[n+1];};
 refreshActive({port:Number(arg('--cdp',9222)),label:arg('--label',''),openBrowser:process.argv.includes('--open-browser')}).then(r=>console.log(`FLOW CREDITS: ${r.remaining} remaining; verified ${r.updated_at}.`)).catch(e=>{console.log('FLOW CREDITS: '+e.message);process.exitCode=1;});
}
module.exports={parseCount,readPanel,selectReading,storeReading,refreshActive};
