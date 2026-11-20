'use strict';
// Project-scoped credit approval, never account-wide settings or regeneration.
function clickProjectApproval(){
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';};
 const label=e=>(e.getAttribute('aria-label')||e.innerText||e.textContent||'').replace(/^[✓✔\s]+/,'').replace(/\s+/g,' ').trim();
 const buttons=[...document.querySelectorAll('button, [role="radio"], [role="button"]')].filter(visible);
 const target=buttons.find(e=>/^Always approve in project$/i.test(label(e)))||buttons.find(e=>/^Approve$/i.test(label(e)));
 if(!target)return false;
 const name=label(target);target.click();return name;
}
module.exports={clickProjectApproval};
