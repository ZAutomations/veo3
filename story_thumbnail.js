'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const extensions=['.png','.jpg','.jpeg','.webp'];
const languages=['English','Russian','Arabic','Hindi','Urdu','Spanish','French','German','Japanese'];
function safeTitle(value){let name=String(value||'').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'');if(!name||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name))name='video';return name.slice(0,180).replace(/[. ]+$/,'')||'video';}
function title(folder){try{const files=fs.readdirSync(folder).filter(n=>n.endsWith('_story.json'));if(files.length===1)return safeTitle(JSON.parse(fs.readFileSync(path.join(folder,files[0]),'utf8').replace(/^\uFEFF/,'')).title);}catch{}return '';}
function valid(file){try{return fs.statSync(file).isFile()&&fs.statSync(file).size>2048&&!!require('./flow_thumbnail_download').imageExtension(fs.readFileSync(file));}catch{return false;}}
function named(folder,base){if(!fs.existsSync(folder))return null;const names=fs.readdirSync(folder);return extensions.map(ext=>names.find(n=>n.toLowerCase()===(base+ext).toLowerCase())).filter(Boolean).map(n=>path.join(folder,n)).find(valid)||null;}
function local(folder,storyTitle){const base=storyTitle?safeTitle(storyTitle):title(folder);return (base&&(named(folder,base)||named(folder,base+' English')))||named(folder,'thumbnail_downloaded')||null;}
function target(folder,ext){return path.join(folder,(title(folder)||'thumbnail_downloaded')+ext);}
function copyImported(folder,storyTitle,sourceFolder){
 if(!sourceFolder)return [];sourceFolder=path.resolve(sourceFolder);if(!fs.existsSync(sourceFolder)||!fs.statSync(sourceFolder).isDirectory())throw Error('Thumbnail source folder does not exist.');
 const base=safeTitle(storyTitle),roots=[],copied=[];
 const destinationRoot=path.resolve(folder);
 const visit=dir=>{
  if(dir===destinationRoot)return;
  roots.push(dir);
  for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   // Do not follow junctions/symlinks outside the selected batch or back into it.
   if(entry.isDirectory()&&!entry.isSymbolicLink()&&!['.git','node_modules'].includes(entry.name))visit(path.join(dir,entry.name));
  }
 };
 visit(sourceFolder);
 for(const suffix of ['',...languages.map(n=>' '+n)]){
 const matches=[...new Set(roots.map(root=>named(root,base+suffix)).filter(Boolean))];if(!matches.length)continue;
 const hashes=new Set(matches.map(f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')));if(hashes.size>1)throw Error('Conflicting thumbnail images for '+base+suffix+'; choose a single-story source folder.');
 const source=matches[0],destination=path.join(folder,base+suffix+require('./flow_thumbnail_download').imageExtension(fs.readFileSync(source)));
 if(path.resolve(source)===path.resolve(destination)){copied.push(destination);continue;}
 // Re-imports must not replace an approved local image.
 if(!fs.existsSync(destination))fs.copyFileSync(source,destination);
 copied.push(destination);
 }
 return copied;
}
module.exports={safeTitle,title,local,target,copyImported,valid};
