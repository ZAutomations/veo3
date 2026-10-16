'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const {voiceOnPromptBox,attachVoice}=require('../flow_voice');
(async()=>{
    let attached=false,category=false,categoryChecks=0;
    const clicks=[];
    const page={
        keyboard:{press:async()=>{},down:async()=>{},up:async()=>{},type:async()=>{}},
        mouse:{click:async(x,y)=>{clicks.push([x,y]);if(x===30)attached=true;}},
        $:async()=>null,
        waitForFunction:async(fn,opts,arg)=>{assert.equal(arg,'Voices');assert.equal(opts.polling,100);if(++categoryChecks<=3)throw Error('simulated delayed category');category=true;},
        evaluate:async(fn,arg)=>{
            if(fn.name==='categoryStateSelected')return category;
            if(fn.name==='agentVoiceChipState')return {count:attached?1:0,verified:attached};
            const code=fn.toString();
            if(code.includes('const held'))throw Error('Unexpected callback');
            if(code.includes('strict ? chips'))return attached;
            if(code.includes('category rails'))return {found:true,selected:false,x:10,y:10};
            if(code.includes('add-menu-icon'))return {x:5,y:5};
            if(code.includes('Search assets')&&!code.includes('detail-add-to')&&!code.includes('const inp'))return true;
            if(code.includes('const candidates')){assert(category);assert.equal(arg.name,'Alnilam');assert.equal(arg.strict,true);return {x:20,y:20,text:'Alnilam'};}
            if(code.includes('detail-add-to'))return {x:30,y:30};
            if(code.includes('button.asset-item').toString())return 1;
            throw Error('Unexpected evaluate: '+code.slice(0,100));
        }
    };
    assert(await attachVoice(page,'Alnilam',{agentMode:true,wait:async()=>{}}));
    assert.equal(categoryChecks,4,'category timeout reopens the picker within the voice operation');
    const before=clicks.length;
    assert(await attachVoice(page,'Alnilam',{agentMode:true,wait:async()=>{}}));
    assert.equal(clicks.length,before,'already attached voice is not added twice');
    // Execute the actual chip readback against an editor containing the name
    // as ordinary text. That must not count as an attached voice.
    let ingredients=[];
    const scope={querySelectorAll:selector=>selector==='flow-audio-ingredient-chip'?[]:ingredients};
    const box={innerText:'Use Alnilam narration',closest:()=>scope,querySelectorAll:()=>[],getBoundingClientRect:()=>({width:100,height:100})};
    const readback={evaluate:async(fn,arg)=>vm.runInNewContext('('+fn.toString()+')(arg)',{arg,window:{__veoAgentEditor:()=>box},document:{querySelectorAll:()=>[box]}})};
    assert.equal(await voiceOnPromptBox(readback,'Alnilam',{agentMode:true,wait:async()=>{}}),false);
    ingredients=[{textContent:'Alnilam',closest:()=>null,querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({width:100,height:20})}];
    assert.equal(await voiceOnPromptBox(readback,'Alnilam',{agentMode:true,wait:async()=>{}}),true);
    ingredients[0].closest=()=>({});
    assert.equal(await voiceOnPromptBox(readback,'Alnilam',{agentMode:true,wait:async()=>{}}),false,'picker entry is not an attached voice');
    ingredients[0].closest=()=>null;
    ingredients[0].classList={contains:()=>true};
    assert.equal(await voiceOnPromptBox(readback,'Alnilam',{agentMode:true,wait:async()=>{}}),false,'disabled ingredient is not accepted');
    const source=fs.readFileSync(require.resolve('../agent_mode'),'utf8');
    assert(source.includes("return ['Alnilam']"));
    assert(source.includes('if (!await attachVoice(page, v)) throw Error'));
    console.log('PASS: Agent Voices selection, exact Alnilam asset, chip verification, duplicate avoidance and submission gate.');
})().catch(e=>{console.error(e);process.exitCode=1;});
