const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),T=require('../story_thumbnail'),I=require('../import_ready_script');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'import-thumb-'));try{
 const source=path.join(root,'source');fs.mkdirSync(source);
 const text=fs.readFileSync(path.join(__dirname,'import_ready_script.js'),'utf8').match(/const text=`([\s\S]*?)`;/)[1];
 const bytes=Buffer.concat([Buffer.from([0xff,0xd8]),Buffer.alloc(3000)]);
 const images=path.join(source,'Story Packages','Blanket Negotiations');fs.mkdirSync(images,{recursive:true});const localized=path.join(images,'Localized Images');fs.mkdirSync(localized);
 fs.writeFileSync(path.join(images,'Blanket Negotiations.jpg'),bytes);fs.writeFileSync(path.join(localized,'Blanket Negotiations Urdu.jpg'),bytes);fs.writeFileSync(path.join(source,'Environment.jpg'),bytes);
 const script=path.join(source,'story.txt');fs.writeFileSync(script,text);
 const [file]=I.run({file:script,out:path.join(root,'out')});const folder=path.dirname(file);
 assert(T.local(folder).endsWith('Blanket Negotiations.jpg'));assert(fs.existsSync(path.join(folder,'Blanket Negotiations Urdu.jpg')));assert(!fs.existsSync(path.join(folder,'Environment.jpg')));assert(!fs.existsSync(path.join(folder,'thumbnail_downloaded.jpg')));
 const changed=Buffer.concat([bytes,Buffer.from('new')]);fs.writeFileSync(path.join(images,'Blanket Negotiations.jpg'),changed);I.run({text,sourceFolder:source,out:path.join(root,'out')});assert(fs.readFileSync(T.local(folder)).equals(bytes),'re-import preserves approved image');
 const story={title:'Blanket Negotiations',preset_id:'geography-map',aspect_ratio:'9:16',scenes:[]};fs.writeFileSync(file,JSON.stringify(story));
 const refs=require('../thumbnail_prompt').withFlowThumbnail([{name:'Environment',kind:'location'}],file);assert.equal(refs.at(-1).localFile,T.local(folder));
 const reused=await require('../flow_thumbnail_project').downloadStoryThumbnail(null,file,'',()=>{});assert.equal(reused,T.local(folder),'no browser needed for a local image');
 const made=require('../flow_thumbnail_download').saveTransferredImage(folder,{data:changed.toString('base64')});assert.equal(path.basename(made),'Blanket Negotiations.jpg');
 fs.writeFileSync(path.join(folder,'Not An Image.png'),Buffer.alloc(3000));assert(!T.valid(path.join(folder,'Not An Image.png')));
 const duplicate=path.join(source,'Duplicate');fs.mkdirSync(duplicate);fs.writeFileSync(path.join(duplicate,'Blanket Negotiations.jpg'),bytes);assert.throws(()=>T.copyImported(folder,'Blanket Negotiations',source),/Conflicting thumbnail/);
 console.log('PASS: recursive batch/subfolder matching and multilingual images; conflicting duplicates stop instead of guessing; file/text import copies only title-matched English/localized images; re-import preserves approved bytes; local reference upload selection and browser-free reuse; downloaded images use story title.');
 }finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
