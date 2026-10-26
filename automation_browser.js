const fs=require('fs'),net=require('net');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function launchPlan(account){
 const am=require('./account_manager');
 const selected=account?am.findAccount(am.load(),account):am.currentAccount();
 if(account&&!selected)throw Error('Selected automation account was not found: '+account);
 const {CONFIG,buildDedicatedProfile}=require('./veo3_flow_new_ui');
 if(!fs.existsSync(CONFIG.CHROME_EXE))throw Error('Google Chrome executable was not found. Install Chrome before running the workflow.');
 return {exe:CONFIG.CHROME_EXE,dir:selected?am.profileDir(selected):buildDedicatedProfile(),profile:selected?'Default':CONFIG.CHROME_PROFILE};
}
async function occupied(url){
 return new Promise(resolve=>{const s=net.connect({host:url.hostname,port:Number(url.port)||80});s.setTimeout(1200);s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false)});});
}
async function connectAutomationBrowser({browserURL='http://127.0.0.1:9222',account='',log=()=>{},timeout=30000,connect,plan,spawn,portOccupied,wait=sleep}={}){
 connect=connect||require('puppeteer').connect;
 const options={browserURL,defaultViewport:null};
 try{return await connect(options);}catch(initial){
  const url=new URL(browserURL);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Cannot connect to the configured remote Chrome: '+browserURL);
  if(await (portOccupied||occupied)(url)){
   // Chrome may already be starting. Never launch another profile on this port.
   for(let i=0;i<10;i++){await wait(500);try{return await connect(options)}catch{}}
   throw Error('CDP port '+url.port+' is occupied but Chrome is not ready. No second browser was opened.');
  }
  const target=(plan||launchPlan)(account);
  log('Automation Chrome is closed; opening the configured profile automatically...');
  const args=['--remote-debugging-port='+(url.port||9222),'--user-data-dir='+target.dir,'--profile-directory='+target.profile,'--no-first-run','--no-default-browser-check','--disable-blink-features=AutomationControlled','--window-size=1920,1080'];
  const child=(spawn||require('child_process').spawn)(target.exe,args,{detached:true,stdio:'ignore',windowsHide:true});
  let launchError;child.on('error',e=>{launchError=e});child.unref();
  let last=initial;
  for(let i=0;i<Math.ceil(timeout/500);i++){
   await wait(500);
   if(launchError)throw Error('Chrome could not start: '+launchError.message);
   try{const browser=await connect(options);log('Automation Chrome is ready; continuing the workflow.');return browser;}catch(e){last=e;}
  }
  throw Error('Chrome was launched but its CDP connection was not ready within '+timeout/1000+' seconds: '+last.message);
 }
}
module.exports={connectAutomationBrowser,launchPlan};
