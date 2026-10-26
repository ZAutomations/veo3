const assert=require('assert'),{EventEmitter}=require('events');
const {connectAutomationBrowser:C}=require('../automation_browser');
(async()=>{
 const browser={pages:async()=>[]};let launches=0,attempts=0;
 const plan=account=>{assert.equal(account,'Chosen');return {exe:'chrome.exe',dir:'C:/Profiles/Chosen',profile:'Default'}};
 const spawn=(exe,args,opts)=>{launches++;assert.equal(exe,'chrome.exe');assert(args.includes('--remote-debugging-port=9333'));assert(args.includes('--user-data-dir=C:/Profiles/Chosen'));assert(args.includes('--profile-directory=Default'));assert(opts.windowsHide);const c=new EventEmitter();c.unref=()=>{};return c;};
 const options={browserURL:'http://127.0.0.1:9333',account:'Chosen',wait:async()=>{},plan,spawn,portOccupied:async()=>false};
 assert.equal(await C({...options,connect:async()=>browser}),browser);assert.equal(launches,0);
 assert.equal(await C({...options,connect:async()=>{if(++attempts<4)throw Error('closed');return browser;}}),browser);assert.equal(launches,1);
 launches=0;attempts=0;
 assert.equal(await C({...options,portOccupied:async()=>true,connect:async()=>{if(++attempts<3)throw Error('starting');return browser;}}),browser);assert.equal(launches,0);
 await assert.rejects(C({...options,portOccupied:async()=>true,connect:async()=>{throw Error('not Chrome')}}),/occupied/);assert.equal(launches,0);
 await assert.rejects(C({...options,browserURL:'http://remote.example:9222',connect:async()=>{throw Error('unreachable')}}),/remote Chrome/);assert.equal(launches,0);
 await assert.rejects(C({...options,timeout:1000,connect:async()=>{throw Error('not ready')}}),/not ready within/);assert.equal(launches,1);
 const files=['project_setup.js','agent_mode.js','agent_download.js','generate_refs.js','veo3_flow_new_ui.js'];for(const f of files)assert(require('fs').readFileSync(f,'utf8').includes('connectAutomationBrowser'),f);
 console.log('PASS: reuse open Chrome, launch once with selected profile/custom port, wait for startup, preserve occupied ports, reject remote auto-launch and bound readiness timeout; all Flow entry points wired.');
})().catch(e=>{console.error(e);process.exitCode=1});
