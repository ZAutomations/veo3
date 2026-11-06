const fs=require('fs'),net=require('net');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const backgroundArgs=['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion'];
async function prepareBackground(browser,log=()=>{}){
 if(browser.__flowBackgroundReady)return browser;
 browser.__flowBackgroundReady=true;
 const sessions=new Map();
 const prepare=async page=>{
  if(!page||sessions.has(page)||typeof page.createCDPSession!=='function')return;
  try{const session=await page.createCDPSession();sessions.set(page,session);
   try{await session.send('Emulation.setFocusEmulationEnabled',{enabled:true});}
   catch(error){log('Background focus emulation unavailable; native-window restore remains enabled: '+error.message);}
   // Background throttling flags do not restore a native Windows window that
   // the user minimized. Restore it just before real input; CDP/DOM reads can
   // continue in the background, but Flow's composer/picker needs a live,
   // focused browser window to receive reliable pointer and keyboard events.
   let lastWindowCheck=0,checking=null;
   const ensureUsable=async()=>{
    if(checking)return checking;
    if(Date.now()-lastWindowCheck<350)return;
    lastWindowCheck=Date.now();
    checking=(async()=>{
     try{
      const {windowId,bounds}=await session.send('Browser.getWindowForTarget');
      if(bounds?.windowState==='minimized'){
       if(typeof browser.setWindowBounds==='function')await browser.setWindowBounds(windowId,{windowState:'normal'});
       else await session.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
       log('Automation Chrome was minimized; restored its window before UI input.');
      }
     }catch(error){log('Could not inspect/restore the automation Chrome window before input: '+error.message);throw Error('Automation browser window state could not be verified; refusing to send UI input while it may be minimized.');}
    })();
    try{await checking;}finally{checking=null;}
   };
   const wrapInput=(target,names)=>{for(const name of names){
    const original=target?.[name];if(typeof original!=='function')continue;
    target[name]=async(...args)=>{await ensureUsable();return original.apply(target,args);};
   }};
   wrapInput(page.mouse,['click','doubleClick','move','down','up','wheel']);
   wrapInput(page.keyboard,['press','type','down','up']);
   // Keep the CDP session attached: emulation ends when the session detaches.
   page.once?.('close',()=>{sessions.delete(page);});
  }catch(error){log('Background focus emulation unavailable: '+error.message);}
 };
 await Promise.all((await browser.pages()).map(prepare));
 browser.on?.('targetcreated',async target=>{try{if(target.type()==='page')await prepare(await target.page());}catch{}});
 // Prepare newly created inspection/download pages before their caller uses them.
 if(typeof browser.newPage==='function'){const original=browser.newPage.bind(browser);browser.newPage=async(...args)=>{const page=await original(...args);await prepare(page);return page;};}
 log('Background browser support enabled: page focus emulation active; Chrome launch disables background throttling.');
 return browser;
}
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
 try{return await prepareBackground(await connect(options),log);}catch(initial){
  const url=new URL(browserURL);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Cannot connect to the configured remote Chrome: '+browserURL);
  if(await (portOccupied||occupied)(url)){
   // Chrome may already be starting. Never launch another profile on this port.
   for(let i=0;i<10;i++){await wait(500);try{return await prepareBackground(await connect(options),log)}catch{}}
   throw Error('CDP port '+url.port+' is occupied but Chrome is not ready. No second browser was opened.');
  }
  const target=(plan||launchPlan)(account);
  log('Automation Chrome is closed; opening the configured profile automatically...');
  const args=['--remote-debugging-port='+(url.port||9222),'--user-data-dir='+target.dir,'--profile-directory='+target.profile,'--no-first-run','--no-default-browser-check','--disable-blink-features=AutomationControlled','--window-size=1920,1080',...backgroundArgs];
  const child=(spawn||require('child_process').spawn)(target.exe,args,{detached:true,stdio:'ignore',windowsHide:true});
  let launchError;child.on('error',e=>{launchError=e});child.unref();
  let last=initial;
  for(let i=0;i<Math.ceil(timeout/500);i++){
   await wait(500);
   if(launchError)throw Error('Chrome could not start: '+launchError.message);
   try{const browser=await connect(options);log('Automation Chrome is ready; continuing the workflow.');return await prepareBackground(browser,log);}catch(e){last=e;}
  }
  throw Error('Chrome was launched but its CDP connection was not ready within '+timeout/1000+' seconds: '+last.message);
 }
}
module.exports={connectAutomationBrowser,launchPlan,prepareBackground,backgroundArgs};
