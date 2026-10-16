// Evaluate in the page immediately before submission. Never choose a global
// Start button belonging to another visible or retained composer.
function verifiedSubmissionTarget({text, references=0}) {
    const pm=window.__veoAgentEditor?.();
    if(!pm)return {ok:false,why:'visible Agent editor missing'};
    const normalize=s=>String(s||'').normalize('NFKC').replace(/\s+/g,' ').trim();
    if(!normalize(pm.innerText||pm.textContent).includes(normalize(text)))
        return {ok:false,why:'the complete batch prompt is missing or changed'};
    if(pm.querySelectorAll('.mention-chip').length<references)
        return {ok:false,why:'reference attachments were lost before submission'};
    const owner=pm.closest('flow-base-prompt-box');
    const b=owner?.querySelector('button[aria-label="Start generation"]');
    if(!b)return {ok:false,why:'Start generation missing in the active Agent composer'};
    if(b.disabled||b.getAttribute('aria-disabled')==='true')return {ok:false,why:'disabled'};
    const r=b.getBoundingClientRect();
    if(!r.width||!r.height)return {ok:false,why:'offscreen'};
    const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
    if(!hit||!(hit===b||b.contains(hit)))return {ok:false,why:'Start generation is covered'};
    return {ok:true,cx:Math.round(x),cy:Math.round(y)};
}
module.exports={verifiedSubmissionTarget};
