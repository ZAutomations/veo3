const assert=require('node:assert/strict');
const puppeteer=require('puppeteer');
const {applyAgentSettings}=require('../agent_settings');
const {agentOn,setAgent}=require('../generate_refs');
(async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
 try{
  const page=await browser.newPage();
  await page.setContent('<button aria-label="Settings" onclick="window.wrong=true">Header</button><button aria-label="Flow Agent" aria-pressed="true">Agent</button><button aria-label="Agent settings">Settings</button><flow-agent-panel></flow-agent-panel>');
  await page.evaluate(()=>{
   window.saved={model:'Omni 1.1 Flash',ratio:'16:9',count:'x2',confirmation:'Always'};
   const toggle=document.querySelector('[aria-label="Flow Agent"]');toggle.onclick=()=>toggle.setAttribute('aria-pressed',String(toggle.getAttribute('aria-pressed')!=='true'));
   window.render=stage=>{
    const panel=document.querySelector('flow-agent-panel');panel.innerHTML='';if(!stage)return;
    const back=document.createElement('button');back.setAttribute('aria-label','Back');back.textContent='Back';back.onclick=()=>render(stage==='agent'?'':'agent');panel.append(back);
    const h=document.createElement('h2');h.className='header-title';h.textContent=stage==='agent'?'Agent settings':'Video defaults';panel.append(h);
    const root=document.createElement(stage==='agent'?'flow-unified-settings-view':'flow-generation-defaults-view');panel.append(root);
    const radios=(label,values,field)=>{
     const group=document.createElement('flow-toggles');group.setAttribute('aria-label',label);root.append(group);
     for(const value of values){const b=document.createElement('button');b.setAttribute('role','radio');b.setAttribute('aria-checked',String(saved[field]===value));b.innerHTML=`<span class="toggle-text">${value}</span>`;b.onclick=()=>{if(field==='confirmation')window.wrong=true;else{saved[field]=value;render(stage);}};group.append(b);}
    };
    if(stage==='agent'){
     radios('Confirm before generating',['Always','Never'],'confirmation');
     const row=document.createElement('button');row.className='video-defaults-row';row.textContent=`Video defaults ${saved.model}, ${saved.ratio}, ${saved.count.slice(1)} output${saved.count==='x1'?'':'s'}`;row.onclick=()=>render('video');root.append(row);
    }else{
     const group=document.createElement('flow-radio-group');group.setAttribute('aria-label','Model');root.append(group);
     for(const model of ['Omni 1.1 Flash','Omni 1.2 Flash']){const label=document.createElement('label');label.innerHTML=`<input type="radio" ${saved.model===model?'checked':''}><span class="radio-option-label">${model}</span>`;label.onclick=e=>{e.preventDefault();saved.model=model;render('video');};group.append(label);}
     radios('Aspect ratio',['16:9','9:16'],'ratio');radios('Number of outputs',['x1','x2'],'count');
    }
   };
   document.querySelector('[aria-label="Agent settings"]').onclick=()=>render('agent');
  });
  assert.equal(await agentOn(page),true);
  assert.equal((await setAgent(page,false)).ok,true);assert.equal(await agentOn(page),false);
  assert.equal((await setAgent(page,true)).ok,true);assert.equal(await agentOn(page),true);
  await applyAgentSettings(page,{videoModel:'Omni 1.2 Flash',aspect:'9:16'});
  assert.deepEqual(await page.evaluate(()=>saved),{model:'Omni 1.2 Flash',ratio:'9:16',count:'x1',confirmation:'Always'});
  assert.equal(await page.evaluate(()=>!!document.querySelector('flow-generation-defaults-view,flow-unified-settings-view')),false);
  assert.equal(await page.evaluate(()=>!!window.wrong),false,'must not click header settings or confirmation');
  await assert.rejects(applyAgentSettings(page,{videoModel:'Unknown Model',aspect:'9:16'}),/unavailable/);
  assert.equal(await page.evaluate(()=>saved.model),'Omni 1.2 Flash');
  // Legacy switch is still supported.
  await page.setContent('<flow-agent-mode-toggle-chip class="checked"><button aria-pressed="true" onclick="this.parentElement.className=\'\';this.setAttribute(\'aria-pressed\',\'false\')">Agent</button></flow-agent-mode-toggle-chip>');
  assert.equal(await agentOn(page),true);assert.equal((await setAgent(page,false)).ok,true);assert.equal(await agentOn(page),false);
  console.log('PASS: new and legacy Agent switches; scoped defaults, saved model/ratio/x1, unchanged confirmation, closed panel, unsupported-model stop.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
