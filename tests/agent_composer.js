'use strict';
const assert=require('assert'),vm=require('vm');
const {focusAgentComposer,pasteAgentPrompt}=require('../agent_composer');
(async()=>{
    const install=()=>{};
    let polls=0,pastes=0,missingPaste=true;
    const calls=[];
    const page={evaluate:async(fn,arg)=>{
        if(fn===install)return;
        if(arg===undefined){polls++;return polls<3?null:{x:10,y:20};}
        pastes++;
        if(missingPaste){missingPaste=false;return {missing:true};}
        return {length:arg.length,verified:true};
    }};
    const opts={wait:async()=>{},log:m=>calls.push(m)};
    assert.equal(await pasteAgentPrompt(page,install,'batch prompt',opts),12);
    assert.equal(pastes,2);
    assert.equal(calls.length,1);
    assert(polls>=4,'fresh editor acquired after its replacement');
    assert(!page.goto&&!page.mouse,'no project navigation or stale coordinate click required');
    await assert.rejects(focusAgentComposer({evaluate:async()=>null},install,{wait:async()=>{},attempts:2}),/No prompt submitted/);
    await assert.rejects(pasteAgentPrompt({evaluate:async(fn,arg)=>fn===install?null:arg===undefined?{x:1,y:1}:{length:3,verified:false}},install,'batch prompt',opts),/complete batch prompt/);
    // Execute the actual paste callback against an editor with a scoped range.
    const pm={innerText:'old text',focus:()=>{},getBoundingClientRect:()=>({x:0,y:0,width:10,height:10})};
    let rangeOwner;
    const document={createRange:()=>({selectNodeContents:e=>rangeOwner=e}),execCommand:(cmd,flag,text)=>{assert.equal(cmd,'insertText');assert.equal(rangeOwner,pm);pm.innerText=text;}};
    const window={__veoAgentEditor:()=>pm,getSelection:()=>({removeAllRanges:()=>{},addRange:()=>{}})};
    const real={evaluate:async(fn,arg)=>fn===install?null:vm.runInNewContext('('+fn.toString()+')(arg)',{window,document,arg})};
    assert.equal(await pasteAgentPrompt(real,install,'first\nsecond',opts),12);
    assert.equal(pm.innerText,'first\nsecond');
    console.log('PASS: delayed/replaced composer recovered; scoped full prompt paste verified; missing/truncated editor cannot submit; no reload or generation calls.');
})().catch(e=>{console.error(e);process.exitCode=1;});
