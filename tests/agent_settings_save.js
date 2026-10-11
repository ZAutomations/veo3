const assert = require('assert');
const { agentDrawerState } = require('../agent_settings');
let scrolled = false;
const hidden = { getBoundingClientRect: () => ({ x:0,y:0,width:100,height:40 }), style: {display:'none',visibility:'visible'} };
const panel = { getBoundingClientRect: () => ({width:400,height:600}), style:{display:'block',visibility:'visible'} };
const save = {
    ...panel, disabled:false, getAttribute:()=>null,
    classList:{contains:()=>true}, closest:()=>panel,
    scrollIntoView:()=>{scrolled=true;},
    getBoundingClientRect:()=>({x:20,y:100,width:100,height:40}),
    contains:el=>el===save
};
global.getComputedStyle = el=>el.style;
global.document = {
    querySelectorAll: selector=>selector==='button'?[hidden,save]:[hidden,panel],
    elementFromPoint:()=>save
};
assert.deepEqual(agentDrawerState(),{open:true,save:{x:70,y:120,clickable:true}});
assert(scrolled);
global.document.querySelectorAll = ()=>[hidden];
assert.deepEqual(agentDrawerState(),{open:false},'retained hidden drawer must count as closed');
delete global.document; delete global.getComputedStyle;
console.log('PASS: visible Save selected over retained hidden controls; hidden drawer counts as closed.');
