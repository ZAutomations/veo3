// Flow's unified defaults auto-save. Preserve the user's confirmation setting.
function defaultsControl({action='state',kind='video',value=''}={}) {
 const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.closest('[aria-hidden="true"],[inert]');};
 const text=e=>{if(!e)return '';const c=e.cloneNode(true);c.querySelectorAll('mat-icon').forEach(i=>i.remove());return (c.textContent||'').replace(/\s+/g,' ').trim();};
 const key=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
 const unified=[...document.querySelectorAll('flow-unified-settings-view')].filter(visible);
 const defaults=[...document.querySelectorAll('flow-generation-defaults-view')].filter(visible);
 const root=unified.length===1?unified[0]:defaults.length===1?defaults[0]:null;
 const panel=root?.closest('flow-agent-panel');
 const heading=text(panel?.querySelector('.header-title'));
 const stage=unified.length===1?'agent':defaults.length===1&&/^video defaults$/i.test(heading)?'video':defaults.length===1&&/^image defaults$/i.test(heading)?'image':'';
 const scoped=selector=>root?[...root.querySelectorAll(selector)].filter(visible):[];
 const models=scoped('flow-radio-group[aria-label="Model"] label');
 const model=models.find(e=>e.querySelector('input[type="radio"]')?.checked);
 const ratios=scoped('flow-toggles[aria-label="Aspect ratio"] button[role="radio"]');
 const counts=scoped('flow-toggles[aria-label="Number of outputs"] button[role="radio"]');
 const confirmation=scoped('flow-toggles[aria-label="Confirm before generating"] button[role="radio"]');
 const selected=items=>text(items.find(e=>e.getAttribute('aria-checked')==='true')?.querySelector('.toggle-text'));
 const row=scoped('button.video-defaults-row')[0];
 if(action==='state')return {stage,model:text(model?.querySelector('.radio-option-label')),ratio:selected(ratios),count:selected(counts),confirmation:selected(confirmation),summary:text(row)};
 let target;
 if(action==='open'){
  const buttons=[...document.querySelectorAll('button[aria-label="Agent settings"]')].filter(visible);
  if(buttons.length===1)target=buttons[0];
 }
 if(action==='video'&&stage==='agent')target=row;
 if(action==='back'){
  const buttons=panel?[...panel.querySelectorAll('button[aria-label="Back"]')].filter(visible):[];
  if(buttons.length===1)target=buttons[0];
 }
 if(stage===kind){
  if(action==='model')target=models.find(e=>key(text(e.querySelector('.radio-option-label')))===key(value));
  if(action==='ratio')target=ratios.find(e=>text(e.querySelector('.toggle-text'))===value);
  if(action==='count')target=counts.find(e=>text(e.querySelector('.toggle-text'))==='x1');
 }
 if(!target||target.disabled||target.getAttribute('aria-disabled')==='true')return false;
 target.click();return true;
}
async function applyUnifiedDefaults(page,{videoModel='',aspect='Flow',resolution='Flow',log=()=>{}}={}) {
 const read=()=>page.evaluate(defaultsControl,{action:'state'});
 const waitFor=async(check,message)=>{for(let n=0;n<40;n++){if(await check())return;await new Promise(r=>setTimeout(r,200));}throw Error(`Agent defaults: ${message}. No generation submitted.`);};
 const click=async(action,value='')=>{
  if(!await page.evaluate(defaultsControl,{action,value}))throw Error(`Agent defaults: ${action} ${value} control is unavailable. No generation submitted.`);
 };
 let state=await read();
 if(!state.stage){
  if(!await page.evaluate(defaultsControl,{action:'open'}))return false;
  await waitFor(async()=>!!(await read()).stage,'unified settings did not open');
  state=await read();
 }
 if(state.stage==='video'||state.stage==='image'){
  await click('back');await waitFor(async()=>(await read()).stage==='agent','could not return to Agent settings');
 }
 const confirmation=(await read()).confirmation;
 await click('video');await waitFor(async()=>(await read()).stage==='video','Video defaults did not open');
 const desiredModel=videoModel&&!/^(flow|auto|default|none)$/i.test(videoModel)?videoModel:'';
 const key=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
 if(desiredModel){await click('model',desiredModel);await waitFor(async()=>key((await read()).model)===key(desiredModel),'selected model did not apply');}
 if(aspect!=='Flow'){await click('ratio',aspect);await waitFor(async()=>(await read()).ratio===aspect,'selected ratio did not apply');}
 await click('count');await waitFor(async()=>(await read()).count==='x1','output count did not become x1');
 const expected=await read();
 await click('back');await waitFor(async()=>(await read()).stage==='agent','could not return to saved defaults');
 await waitFor(async()=>{const s=await read();return s.confirmation===confirmation&&s.summary.includes(expected.model)&&s.summary.includes(expected.ratio)&&/\b1 output\b/.test(s.summary);},'saved video defaults summary does not match');
 // Reopen and verify persisted radio values, then close both levels.
 await click('video');await waitFor(async()=>{const s=await read();return s.stage==='video'&&s.model===expected.model&&s.ratio===expected.ratio&&s.count==='x1';},'video defaults failed persistence check');
 await click('back');await waitFor(async()=>(await read()).stage==='agent','video settings did not close');
 await click('back');await waitFor(async()=>!(await read()).stage,'Agent settings remained over the composer');
 log(`Agent defaults verified: ${expected.model} / ${expected.ratio} / x1; confirmation ${confirmation} preserved; resolution instruction ${resolution} (prompt only).`);
 return true;
}
module.exports={defaultsControl,applyUnifiedDefaults};
