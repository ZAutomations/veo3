const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),puppeteer=require('puppeteer');
(async()=>{
 const root=path.resolve(__dirname,'..'),ui=path.join(root,'desktop_ui');
 const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
 const browser=await puppeteer.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  const page=await browser.newPage();
  let html=fs.readFileSync(path.join(ui,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  html=html.replace(/<link[^>]*href="\/assets\/([^"?]+\.css)"[^>]*>/g,(_,file)=>'<style>'+fs.readFileSync(path.join(ui,file),'utf8')+'</style>');
  const source=fs.readFileSync(path.join(ui,'app.js'),'utf8');
  const names=vm.runInNewContext('('+source.match(/const names = (\{[^\n]+\});/)[1]+')');
  await page.setContent(html);
  await page.$eval('#navigation',(nav,rows)=>{for(const [key,label] of rows){const button=document.createElement('button');button.className='nav-item';button.innerHTML='<svg viewBox="0 0 24 24"></svg>';const span=document.createElement('span');span.textContent=label;button.append(span);nav.append(button);}},Object.entries(names).filter(([key])=>!['ingredients','omni'].includes(key)));
  for(const [width,height] of [[1920,1080],[1366,768],[1280,600],[1024,480],[800,360],[390,700],[360,400]]){
   await page.setViewport({width,height});
   const layout=await page.evaluate(()=>{
    const box=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
    return {button:box('#open-writer-window'),nav:box('#navigation'),footer:box('.sidebar-bottom'),side:box('.sidebar'),label:document.querySelector('#open-writer-window').textContent};
   });
   assert(layout.button.top>=0&&layout.button.bottom<=height,`Standalone clipped at ${width}x${height}`);
   assert(layout.side.left>=0&&layout.side.right<=width+1);
   assert(layout.nav.bottom<=layout.footer.top+1,`Navigation overlaps footer at ${width}x${height}`);
   assert(layout.label.includes('Story Writer Standalone'));
   await page.$eval('#navigation',nav=>{nav.lastElementChild.scrollIntoView({block:'nearest',inline:'nearest'});});
   const last=await page.$eval('#navigation',nav=>{const a=nav.getBoundingClientRect(),b=nav.lastElementChild.getBoundingClientRect();return b.top>=a.top-1&&b.bottom<=a.bottom+1&&b.left>=a.left-1&&b.right<=a.right+1;});
   assert(last,`Last navigation entry unreachable at ${width}x${height}`);
  }
  await page.setViewport({width:1024,height:480});
  await page.screenshot({path:path.join(root,'backups/workspace_responsive_20261115/compact-sidebar.png')});
  console.log('PASS: standalone writer stays visible and navigation remains reachable without overlap at seven desktop/mobile sizes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
