const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {UpscaledDownloader}=require('./single_clip_omni_upscaled');
function plan(tiles,story){
 const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 return story.scenes.map((scene,i)=>{
  const lines=scene.dialogue?.length?scene.dialogue.map(d=>d.line):[scene.script_line];
  const needles=lines.filter(Boolean).map(norm);
  if(!needles.length||needles.join('').length<20)throw Error(`Scene ${i+1}: insufficient source text for reliable clip matching.`);
  const hits=tiles.filter(t=>t.assetId&&needles.every(n=>norm(t.prompt||t.text).includes(n))).sort((a,b)=>a.index-b.index);
  if(!hits.length)throw Error(`Scene ${i+1}: completed matching source not found. Upscaled download stopped without substituting another scene.`);
  const metadata=String(hits[0].text||hits[0].prompt||'').split(/Created\s/i).pop();
  return {job:{number:i+1,scene,prompt:String(scene.veo3_prompt||lines.join('\n'))},receipt:{scene:i+1,assetId:hits[0].assetId,key:'',native720:/\b720p\b/i.test(metadata)&&!/\b360p\b/i.test(metadata)}};
 });
}
async function download(browser,page,{storyFile,outDir,project,tiles,log=()=>{}}){
 if(!storyFile||!fs.existsSync(storyFile))throw Error('Upscaled Agent download needs the story JSON to map scenes safely.');
 const story=JSON.parse(fs.readFileSync(storyFile,'utf8'));
 const entries=plan(tiles,story);
 const jobs=entries.map(e=>e.job),receipts=Object.fromEntries(entries.map(e=>[e.job.number,e.receipt]));
 const d=new UpscaledDownloader({browser,page,projectUrl:project},{folder:path.dirname(path.resolve(storyFile)),outDir,total:jobs.length,ledgerPrefix:'agent_upscaled',allowNative720:true,storyHash:crypto.createHash('sha256').update(JSON.stringify(jobs.map(j=>j.prompt))).digest('hex'),log});
 try{await d.group(jobs,receipts);log('Agent clips saved as verified Upscaled 720p in story order.');}finally{await d.close();}
}
module.exports={plan,download};
