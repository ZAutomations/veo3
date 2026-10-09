const fs=require('fs'),path=require('path');
const puppeteer=require('puppeteer');
const media=require('./single_clip_omni_media');
const bg=require('./single_clip_omni_background');
const {normalizeProjectUrl}=require('./flow_project');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function clickVideoTrash({key,assetId}){
 const store=window.__singleOmniTileKeys;
 const tile=[...document.querySelectorAll('flow-video-tile')].find(t=>store?.keys.get(t)===key||assetId&&[...t.querySelectorAll('video,source,img')].some(e=>(e.currentSrc||e.getAttribute('src')||'').includes('/'+assetId)));
 if(!tile||tile.closest('flow-character-tile,flow-image-tile,flow-scene-tile'))return false;
 let owner=tile;
 for(let depth=0;owner&&depth<10;depth++,owner=owner.parentElement){
  if(owner.matches?.('main,body,[role="main"]'))break;
  if(owner.querySelectorAll('flow-image-tile,flow-character-tile,flow-scene-tile').length)break;
  const buttons=[...owner.querySelectorAll('button')].filter(b=>!b.disabled);
  const button=buttons.find(b=>/^(?:Trash batch|Move to trash|Delete video)$/i.test(b.getAttribute('aria-label')||''));
  if(button){button.click();return 'trashed';}
  const menu=buttons.find(b=>/^More options$/i.test(b.getAttribute('aria-label')||'')||b.querySelector?.('mat-icon')?.textContent?.trim()==='more_vert');
  if(menu){menu.click();return 'menu';}
 }
 return false;
}
function clickTrashMenuItem(){
 const items=[...document.querySelectorAll('.cdk-overlay-container [role="menuitem"],.cdk-overlay-container button[mat-menu-item]')];
 const matches=items.filter(e=>{const r=e.getBoundingClientRect();const label=(e.querySelector('.label')?.textContent||e.getAttribute('aria-label')||e.innerText||e.textContent||'').trim();return r.width>0&&r.height>0&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&/^Move to trash$/i.test(label);});
 if(matches.length>1)throw Error('More than one visible Move to trash item; no click made.');
 if(!matches.length)return false;matches[0].click();return true;
}
async function moveVideoToTrash(page,tile,{wait=sleep}={}){
 await page.evaluate(bg.closeMenus);
 const action=await page.evaluate(clickVideoTrash,tile);
 if(!action)throw Error('Could not locate this video\'s menu or Trash control. Images/characters were not touched.');
 if(action==='menu'){
  let clicked=false;
  for(let i=0;i<20&&!clicked;i++){await wait(150);clicked=await page.evaluate(clickTrashMenuItem);}
  if(!clicked)throw Error('Move to trash was not found in the selected video\'s menu. Nothing else clicked.');
 }
 return action;
}
async function scanForDeletion(page,{wait=sleep}={}){
 await page.evaluate(bg.scrollToPosition,0);await wait(500);
 const seen=new Map();let quiet=0;
 for(let i=0;i<200;i++){
  const before=seen.size;
  for(const t of await media.snapshot(page))seen.set(t.assetId||t.key,t);
  const m=await page.evaluate(bg.metrics);
  if(i%10===0)console.log(`Checking project: ${seen.size} video card(s), scroll ${Math.round(m.top)}/${Math.round(m.scroll-m.client)}.`);
  if(m.top>=m.scroll-m.client-2){if((m.visible||m.scroll<=m.client)&&seen.size===before&&++quiet>=2)return {project_scan_complete:true,flow_video_tile:seen.size,generating_video_tile:[...seen.values()].filter(t=>t.busy).length};await wait(500);}
  else{quiet=0;await page.evaluate(bg.scrollToPosition,m.top+Math.floor(m.client*0.75));await wait(500);const after=await page.evaluate(bg.metrics);if(after.top<=m.top+2)throw Error('Project scroll did not advance; deletion stopped.');}
 }
 throw Error('Project check exceeded its bounded scan; deletion stopped.');
}
function confirmTrashDialog(){
 const dialogs=[...document.querySelectorAll('[role="dialog"],mat-dialog-container')].filter(e=>e.getBoundingClientRect().width>0);
 if(!dialogs.length)return 'none';
 if(dialogs.length!==1)return 'unknown';
 const buttons=[...dialogs[0].querySelectorAll('button')].filter(b=>!b.disabled&&/^(?:Move to trash|Delete|Trash|Confirm)$/i.test((b.innerText||b.textContent||'').trim()));
 if(buttons.length!==1)return 'unknown';buttons[0].click();return 'confirmed';
}
function archiveCheckpoints(storyFile,project){
 if(!storyFile||!fs.existsSync(storyFile))return;
 const folder=path.dirname(path.resolve(storyFile)),id=project.split('/project/')[1];
 const files=fs.readdirSync(folder).filter(f=>f.endsWith('.json')&&(f.startsWith(`single_clip_omni_${id}_`)||f===`agent_batches_${id}.json`||f===`omni_upscaled_${id}.json`||f===`agent_upscaled_${id}.json`));
 const archive=path.join(folder,`before_project_clip_deletion_${Date.now()}`);fs.mkdirSync(archive,{recursive:true});
 for(const file of files)fs.renameSync(path.join(folder,file),path.join(archive,file));
 for(const file of ['manifest.json','omni_manifest.partial.json']){
  const target=path.join(folder,'clips',file);if(!fs.existsSync(target))continue;
  let m;try{m=JSON.parse(fs.readFileSync(target));}catch{continue;}
  if(m.projectUrl===project||m.project===project)fs.renameSync(target,path.join(archive,file));
 }
 console.log('Archived project checkpoints. Local MP4 files and references were retained.');
}
async function run(request){
 if(request.confirmed!==true)throw Error('Project clip deletion requires the GUI confirmation.');
 const url=new URL(request.project);if(url.protocol!=='https:'||url.hostname!=='flow.google.com'||!/^\/project\/[a-zA-Z0-9-]+(?:\/|$)/.test(url.pathname))throw Error('A valid Flow project URL is required.');
 const project=normalizeProjectUrl(request.project),browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${Number(request.cdp)||9222}`,defaultViewport:null});
 try{
  const pages=await browser.pages();const page=pages.find(p=>p.url().replace(/\/$/,'')===project)||await browser.newPage();
  if(page.url().replace(/\/$/,'')!==project)await page.goto(project,{waitUntil:'domcontentloaded',timeout:120000});
  await page.bringToFront();await page.waitForSelector('flow-video-tile,flow-image-tile,flow-character-tile',{timeout:30000});
  console.log('Checking the project once before deleting video clips...');
  const inventory=await scanForDeletion(page);
  if(!inventory.project_scan_complete)throw Error('Full project check was incomplete. No clip deleted.');
  if(inventory.generating_video_tile)throw Error('Clips are still generating. Wait for them to finish before deleting. No clip deleted.');
  await page.evaluate(bg.scrollToPosition,0);await sleep(700);
  let removed=0,quiet=0;
  for(let step=0;step<5000;step++){
   const tiles=await media.snapshot(page);
   if(tiles.some(t=>t.busy))throw Error('A generation appeared during deletion; stopped safely.');
   if(tiles.length){
    const tile=tiles[0];
    console.log('Opening this video\'s controls > Move to trash...');
    await moveVideoToTrash(page,tile);
    await sleep(300);const dialog=await page.evaluate(confirmTrashDialog);
    if(dialog==='unknown')throw Error('Unrecognized confirmation dialog; deletion stopped.');
    let gone=false;
    for(let n=0;n<20;n++){await sleep(300);const current=await media.snapshot(page);if(!current.some(t=>tile.assetId?t.assetId===tile.assetId:t.key===tile.key)){gone=true;break;}}
    if(!gone)throw Error('Video removal was not confirmed; stopped without clicking again.');
    removed++;quiet=0;console.log(`Removed ${removed} video card(s); images and characters retained.`);continue;
   }
   const m=await page.evaluate(bg.metrics);
   if(m.top>=m.scroll-m.client-2){if(++quiet>=3)break;await sleep(700);}
   else{quiet=0;await page.evaluate(bg.scrollToPosition,m.top+Math.floor(m.client*0.75));await sleep(700);}
  }
  const final=await scanForDeletion(page);
  if(!final.project_scan_complete||final.flow_video_tile)throw Error('Videos remain or final scan is incomplete. Project reset was not marked complete.');
  archiveCheckpoints(request.story,project);
  console.log('All video clips moved to Flow Trash. Images and Characters retained.');
 }finally{await browser.disconnect();}
}
module.exports={run,clickVideoTrash,clickTrashMenuItem,moveVideoToTrash,scanForDeletion,confirmTrashDialog,archiveCheckpoints};
if(require.main===module)run(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))).catch(e=>{console.error('DELETE CLIPS STOP: '+e.message);process.exitCode=1;});
