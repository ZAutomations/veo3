'use strict';
const fs=require('fs'),path=require('path');
function localThumbnail(folder){
 return ['.png','.jpg','.jpeg','.webp'].map(ext=>path.join(folder,'thumbnail_downloaded'+ext))
  .find(file=>fs.existsSync(file)&&fs.statSync(file).size>2048)||null;
}
async function ensure(folder,{log=console.log,connect}={}){
 folder=path.resolve(folder);
 const files=fs.readdirSync(folder).filter(n=>n.endsWith('_story.json'));
 if(files.length!==1)return null;
 const storyFile=path.join(folder,files[0]),story=JSON.parse(fs.readFileSync(storyFile,'utf8').replace(/^\uFEFF/,''));
 if(!require('./thumbnail_prompt').isFlowEndcardPreset(story))return null;
 const saved=localThumbnail(folder);if(saved)return saved;
 let manifest={};try{manifest=JSON.parse(fs.readFileSync(path.join(folder,'clips','manifest.json'),'utf8'));}catch{}
 let project=manifest.projectUrl||manifest.project_url;
 if(!project){
  const projects=new Set();
  let hashes=null;
  for(const name of fs.readdirSync(folder).filter(n=>/^agent_(?:upscaled|original)(?:_assets)?_.*\.json$/.test(n))){
   try{
    const ledger=JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'));
    let matching=ledger.clips?.some(c=>c.file&&fs.existsSync(path.join(folder,'clips',c.file)));
    if(!matching&&Array.isArray(ledger.clips)){
     if(!hashes){
      hashes=new Set();const clips=path.join(folder,'clips');
      if(fs.existsSync(clips))for(const name of fs.readdirSync(clips).filter(n=>/\.mp4$/i.test(n)))
       hashes.add(require('crypto').createHash('sha256').update(fs.readFileSync(path.join(clips,name))).digest('hex'));
     }
     matching=ledger.clips.some(c=>c.sha256&&hashes.has(c.sha256));
    }
    if(ledger.project&&matching)
     projects.add(require('./flow_project').normalizeProjectUrl(ledger.project));
   }catch{}
  }
  if(projects.size===1)project=[...projects][0];
  else if(projects.size>1)throw Error('THUMBNAIL_REQUIRED: Multiple downloaded Flow projects exist for this story; choose the intended project before fetching its thumbnail.');
 }
 if(!project)throw Error('THUMBNAIL_REQUIRED: No saved Flow project URL for this story. Download its thumbnail before joining/editing; clips preserved.');
 const home=require('./flow_project').normalizeProjectUrl(project);
 const browser=await (connect||(()=>require('puppeteer').connect({browserURL:'http://127.0.0.1:9222'})))();
 try{
  const pages=await browser.pages();
  let page=pages.find(p=>p.url().split('?')[0]===home);
  if(!page){page=await browser.newPage();await page.goto(home,{waitUntil:'domcontentloaded',timeout:120000});}
  if(/\/404(?:\?|$)/.test(page.url()))throw Error(`THUMBNAIL_REQUIRED: Saved project ${home} is unavailable in the current Flow account. Open its original account and retry; no image generated.`);
  const file=await require('./flow_thumbnail_project').downloadStoryThumbnail(page,storyFile,home,log);
  if(!file)throw Error('THUMBNAIL_REQUIRED: Preset thumbnail could not be downloaded; no replacement image generated.');
  return file;
 }finally{await browser.disconnect();}
}
if(require.main===module)ensure(process.argv[2]||'.').then(file=>{if(file)console.log('STORY_THUMBNAIL: '+file);}).catch(e=>{console.error(e.message);process.exitCode=2;});
module.exports={ensure,localThumbnail};
