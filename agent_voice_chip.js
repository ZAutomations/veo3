// Browser-side helpers for Flow's nameless voice ingredient. The library item
// proves the name; a newly mounted audio chip proves Add to prompt landed.
function agentVoiceChipState({phase,name}={}) {
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
 const editor=window.__veoAgentEditor?.() || [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')].find(visible);
 const scope=editor?.closest('flow-base-prompt-box, .base-prompt-box') || editor;
 const chips=scope?[...scope.querySelectorAll('flow-audio-ingredient-chip')].filter(c=>visible(c)&&!c.closest('.cdk-overlay-pane')):[];
 const valid=chips.filter(c=>{const b=c.querySelector('button[aria-label="Ingredient"]');return b&&!b.disabled&&b.getAttribute('aria-busy')!=='true'&&!b.classList.contains('chip-container-disabled')&&!c.querySelector('.disabled-error-icon');});
 window.__veoAgentVoiceNames ||= new WeakMap();
 if(phase==='clear') {
  for(const c of chips){
   const cancel=c.querySelector('.hover-icon-overlay');
   if(!cancel)throw Error('Existing voice ingredient has no remove control.');
   cancel.click();
  }
 }
 if(phase==='capture')window.__veoAgentVoiceBefore=new Set(chips);
 if(phase==='mark') {
  const added=valid.filter(c=>!window.__veoAgentVoiceBefore?.has(c));
  if(added.length===1&&valid.length===1)window.__veoAgentVoiceNames.set(added[0],name);
 }
 return {count:chips.length,verified:valid.length===1&&window.__veoAgentVoiceNames.get(valid[0])===name};
}
module.exports={agentVoiceChipState};
