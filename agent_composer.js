'use strict';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function focusAgentComposer(page,install,{wait=sleep,attempts=60,log=()=>{}}={}) {
    for(let n=0;n<attempts;n++) {
        try {
            await page.evaluate(install);
            const box=await page.evaluate(()=>{
                const pm=window.__veoAgentEditor?.();
                if(!pm)return null;
                pm.focus();
                const r=pm.getBoundingClientRect();
                return {x:r.x+r.width/2,y:r.y+r.height/2};
            });
            if(box)return box;
        } catch(e) {
            if(!/execution context|detached|destroyed|cannot find context/i.test(e.message||''))throw e;
        }
        if(n===0)log('Agent composer is changing; waiting for the current editable prompt box.');
        await wait(250);
    }
    throw Error('Agent composer did not become editable within 15 seconds. No prompt submitted.');
}
async function pasteAgentPrompt(page,install,text,opts={}) {
    // The reference picker/settings can mount a new editor after focus. Never
    // retain an ElementHandle or screen coordinates across that transition.
    for(let attempt=0;attempt<3;attempt++) {
        await focusAgentComposer(page,install,opts);
        let result;
        try {
            result=await page.evaluate(t=>{
                const pm=window.__veoAgentEditor?.();
                if(!pm)return {missing:true};
                pm.focus();
                const selection=window.getSelection(),range=document.createRange();
                range.selectNodeContents(pm);selection.removeAllRanges();selection.addRange(range);
                document.execCommand('insertText',false,t);
                const got=pm.innerText||pm.textContent||'';
                const norm=s=>s.replace(/\r\n/g,'\n').replace(/\s+/g,' ').trim();
                return {length:got.length,verified:norm(got)===norm(t)};
            },text);
        } catch(e) {
            if(!/execution context|detached|destroyed|cannot find context/i.test(e.message||''))throw e;
            result={missing:true};
        }
        if(result.missing){await (opts.wait||sleep)(250);continue;}
        if(!result.verified)throw Error('The editor did not retain the complete batch prompt. No generation submitted.');
        return result.length;
    }
    throw Error('Agent composer kept changing during paste. No prompt submitted.');
}
module.exports={focusAgentComposer,pasteAgentPrompt};
