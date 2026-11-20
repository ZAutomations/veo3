const assert=require('assert'),{inspectLayout}=require('../flow_composer_layout');
let clicked=[];const panel={getBoundingClientRect:()=>({width:344,height:512})};
const close={getBoundingClientRect:()=>({width:34,height:34}),classList:{contains:()=>false},closest:s=>s==='flow-agent-panel'?panel:s==='.agent-panel-header'?{}:null,click:()=>clicked.push('agent-close')};
const other={getBoundingClientRect:()=>({width:34,height:34}),classList:{contains:()=>false},closest:()=>null,click:()=>{throw Error('Unrelated Close clicked')}};
global.document={querySelectorAll:s=>{assert.equal(s,'button[aria-label="Close"]');return [other,close]}};
assert.equal(inspectLayout(false),'side-session');assert.deepEqual(clicked,[]);assert.equal(inspectLayout(true),'side-session');assert.deepEqual(clicked,['agent-close']);
console.log('PASS: new Agent panel closes without legacy class; unrelated Close excluded');
