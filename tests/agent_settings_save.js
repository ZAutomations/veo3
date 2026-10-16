const assert = require('assert');
const { agentDrawerState,saveAgentSettings } = require('../agent_settings');
let scrolled = false;
const hidden = { getBoundingClientRect: () => ({ x:0,y:0,width:100,height:40 }), style: {display:'none',visibility:'visible'} };
const panel = { innerText:'Confirm before generating Video generation default',closest:()=>null,querySelectorAll:()=>[hidden,save],getBoundingClientRect: () => ({width:400,height:600}), style:{display:'block',visibility:'visible'} };
const save = {
    ...panel, disabled:false, getAttribute:()=>null,
    classList:{contains:()=>true}, closest:s=>s==='.settings-content'?panel:null,
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
global.document.querySelectorAll=()=>[{...panel,innerText:'Main page settings Video defaults'}];
assert.deepEqual(agentDrawerState(),{open:false},'main page settings do not mean Agent settings are open');
global.document.querySelectorAll=()=>[{...panel,getBoundingClientRect:()=>({width:400,height:600,top:1000,bottom:1600,left:0,right:400})}];
global.innerHeight=800;
assert.deepEqual(agentDrawerState(),{open:false},'offscreen retained Agent panel is closed');
delete global.innerHeight;
global.document.querySelectorAll=()=>[{...panel,closest:selector=>selector==='.agent-panel-slide-out'?{}:null}];
assert.deepEqual(agentDrawerState(),{open:false},'closed slide-out panel retains positive dimensions but must not be clicked again');
delete global.document; delete global.getComputedStyle;
(async()=>{
 let clicks=0,open=true;
 const page={evaluate:async()=>({open,save:{x:70,y:120,clickable:true}}),mouse:{click:async()=>{clicks++;if(clicks===2)open=false;}}};
 await saveAgentSettings(page,{wait:async()=>{}});
 assert.equal(clicks,2,'first ignored click receives one bounded physical retry');
 clicks=0;open=false;await saveAgentSettings(page,{wait:async()=>{}});assert.equal(clicks,0);
 open=true;page.mouse.click=async()=>{clicks++;};
 await assert.rejects(saveAgentSettings(page,{wait:async()=>{}}),/two verified Save clicks/);
 assert.equal(clicks,2);
 let polls=0,transitionClicks=0;
 const transition={evaluate:async()=>({open:transitionClicks===0,save:++polls<4?null:{x:70,y:polls===4?180:120,clickable:polls>4}}),mouse:{click:async()=>transitionClicks++}};
 await saveAgentSettings(transition,{wait:async()=>{}});
 assert.equal(transitionClicks,1,'waits through absent, covered and moving Save before one click');
 assert(polls>=7);
 await assert.rejects(saveAgentSettings({evaluate:async()=>({open:true,save:null}),mouse:{click:async()=>{throw Error('must not click');}}},{wait:async()=>{}}),/stayed unavailable/);
 console.log('PASS: only visible Agent panel counted; hidden/offscreen/unrelated settings excluded; real Save click retried once; persistent failure cannot submit.');
})().catch(e=>{console.error(e);process.exitCode=1;});
