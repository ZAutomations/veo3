const assert = require('assert');
const {clickAgentSettings, agentSettingsReady, openAgentSettings, clickAgentSave} = require('../agent_settings');
const box = () => ({width:100,height:40});
let headerClicks=0, agentClicks=0;
const button = click => ({getBoundingClientRect:box, disabled:false,
    getAttribute:()=> 'Settings', querySelectorAll:()=>[{textContent:'tune'}], click});
const header=button(()=>headerClicks++), agent=button(()=>agentClicks++);
const footer={getBoundingClientRect:box,querySelectorAll:()=>[agent]};
global.getComputedStyle=()=>({display:'block',visibility:'visible'});
global.window={};
global.document={querySelectorAll:selector=>selector==='.agent-footer-actions'?[footer]:[header,agent]};
assert(clickAgentSettings());
assert.equal(agentClicks,1); assert.equal(headerClicks,0);
global.document.querySelectorAll=()=>[];
assert.equal(clickAgentSettings(),false,'must not fall back to main-page Settings');
const panel = text => ({innerText:text,getBoundingClientRect:box,
    querySelectorAll:()=>[{...button(()=>{}),textContent:'Save',querySelector:()=>null}]});
global.document.querySelectorAll=()=>[panel('Project settings Video generation default')];
assert.equal(agentSettingsReady(),false);
global.document.querySelectorAll=()=>[panel('Confirm before generating Video generation default')];
assert.equal(agentSettingsReady(),true);
let saves=0;
const save={...button(()=>saves++),textContent:'Save',querySelector:()=>null};
const root={querySelectorAll:()=>[save]};
const siblingSavePanel={...panel('Confirm before generating Video generation default'),closest:selector=>selector==='flow-settings-view'?root:null};
global.document.querySelectorAll=()=>[siblingSavePanel];
assert(agentSettingsReady(),'Save is outside settings-content in the current UI');
assert(clickAgentSave()); assert.equal(saves,1);
(async()=>{
    let clicks=0;
    const page={evaluate:async fn=>fn===agentSettingsReady?false:(clicks++,true),
        waitForFunction:async()=>{throw Error('wrong drawer');}};
    assert.equal(await openAgentSettings(page),false);
    assert.equal(clicks,1,'do not repeatedly click Settings when the wrong panel opens');
    delete global.document; delete global.window; delete global.getComputedStyle;
    console.log('PASS: Agent footer selected instead of main Settings; wrong drawer rejected.');
})().catch(e=>{console.error(e);process.exitCode=1;});
