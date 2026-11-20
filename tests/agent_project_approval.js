const assert=require('assert'),{clickProjectApproval}=require('../agent_project_approval');
global.getComputedStyle=()=>({display:'block',visibility:'visible'});
let clicked=[];function button(text,disabled=false){return {textContent:text,disabled,getAttribute:()=>null,getBoundingClientRect:()=>({width:100,height:30}),click:()=>clicked.push(text)}}
let rows=[button('Approve'),button('Always approve in project'),button('Reject')];global.document={querySelectorAll:()=>rows};assert.equal(clickProjectApproval(),'Always approve in project');assert.deepEqual(clicked,['Always approve in project']);
rows=[button('Approve'),button('Always approve in project',true)];assert.equal(clickProjectApproval(),'Approve');
rows=[button('Try again'),button('Start generation'),button('Reject')];assert.equal(clickProjectApproval(),false);
console.log('PASS: text-only project approval prioritized; disabled/negative/replay controls excluded');

rows=[button('Approve'),button('check Always approve in project')];
rows[1].getAttribute=name=>name==='aria-label'?'Always approve in project':name==='role'?'radio':null;
assert.equal(clickProjectApproval(),'Always approve in project');
rows[1].getAttribute=name=>name==='aria-label'?'Always approve in project':name==='aria-disabled'?'true':null;
rows=[rows[1]];assert.equal(clickProjectApproval(),false);
console.log('PASS: Flow role-radio approval supported; expired read-only approvals ignored');
