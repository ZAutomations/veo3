// Deterministic local importer. No model calls and no media generation.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {parse,ImportValidationError}=require('./ready_script_parser');
function writerFor(s,aspect){
 const old=process.argv;
 try{process.argv=[process.execPath,'write_story.js','--title',s.title,'--seconds',String(s.seconds),'--duration',String(s.seconds*s.clips.length),'--aspect',aspect];delete require.cache[require.resolve('./write_story')];return require('./write_story');}
 finally{process.argv=old;}
}
function prepare(s,aspect){
 const W=writerFor(s,aspect),p=W.loadPreset(s.preset);
 if(require('./reference_video_preset').applies(p))return require('./reference_video_preset').prepare(W,p,s,aspect);
 if(require('./heartwarming_cat').applies(p))return require('./heartwarming_cat').prepare(W,p,s,aspect);
 if(require('./motivational_metaphor').applies(p))return require('./motivational_ready_script').prepare(W,p,s,aspect);
 if(p.id==='fern-documentary')return require('./fern_ready_script').prepare(W,p,s,aspect);
 if(p.id==='3d-zack-style')return require('./zack_ready_script').prepare(W,p,s,aspect);
 if(p.narration_scope!=='dialogue'||!p.fixed_couple_names||(!require('./dog_couple').applies(p)&&!require('./realistic_couple').enabled(p)))throw Error('Ready script import currently supports realistic, Ghibli, stylized 3D, colorful cartoon and dog-couple Sarah/SAM dialogue presets, Zack D, Fern Documentary, 3D Motivational Red vs Green and Heartwarming Cat.');
 const cast=W.normaliseCast(p,[{name:'Sarah',gender:'female',type:'human'},{name:'SAM',gender:'male',type:'human'}]);
 const meta={description:s.title,moral:'',place_name:'Room',place_description:s.setting,place_prompt:`${p.location_medium||p.style}. Empty ${s.setting}. No people or animals, no text.`,blocking:p.blocking||''};
 const story=W.buildStory(p,cast,meta,s.clips.map(c=>({scene_title:c.title,dialogue:c.dialogue,narrative_context:c.action||'The two characters exchange these lines naturally in the established setting.',characters:['Sarah','SAM']})));
 story.script_import=true;story.imported_actions=s.clips.map(c=>c.action);
 // Keep imported actions available to the minimal prompt builder.
 story.scenes.forEach((scene,i)=>scene.imported_action=s.clips[i].action);
 const warnings=s.clips.flatMap(c=>{const words=c.dialogue.map(t=>t.line).join(' ').split(/\s+/).length;return words>s.seconds*3?[`Clip ${c.number}: ${words} words in ${s.seconds}s may be too long. Shorten the lines or use a longer clip.`]:[];});
 return {W,p,cast,story,warnings};
}
function semanticKey(source){
 const key=JSON.parse(JSON.stringify(source));
 // Story numbering, diagnostics and validation profiles never changed the
 // rendered content. Keep the legacy hash so re-imports reuse saved packages.
 delete key.storyNumber;delete key.production_profile;
 if(!key.continuity)delete key.continuity;
 if(!key.details)delete key.details;
 return key;
}
function inputs(request){
 if(typeof request.text==='string')return [{text:request.text}];
 let files=request.files|| (request.file?[request.file]:[]);
 if(request.folder)files=fs.readdirSync(request.folder).filter(f=>/\.txt$/i.test(f)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(f=>path.join(request.folder,f));
 if(!Array.isArray(files)||!files.length)throw new ImportValidationError('Supply script text, a TXT file, files, or a folder containing TXT files.');
 return files.map(file=>({file:path.resolve(file),text:fs.readFileSync(file,'utf8')}));
}
function run(request){
 const aspect=request.aspect||'9:16';if(!['9:16','16:9','1:1','Flow'].includes(aspect))throw new ImportValidationError('Invalid aspect ratio.');
 const sourceInputs=inputs(request),origins=new Map();
 const parsed=sourceInputs.flatMap(input=>parse(input.text,request).map(source=>{origins.set(source,input);return source;}));
 // Validate identifiers across files as well as within each parsed TXT.
 const strictNumbers=new Set();
 for(const source of parsed.filter(s=>s.production_profile==='zetomate-8x8')){
  if(strictNumbers.has(source.storyNumber))throw new ImportValidationError('Duplicate story number in this strict production batch.',
   {storyNumber:source.storyNumber,title:source.title,section:'Metadata',field:'Story',line:source._source.line});
  strictNumbers.add(source.storyNumber);
 }
 // Validate every story before creating any package.
 const prepared=parsed.map(s=>{
  try{return prepare(s,aspect);}catch(error){
   if(error.permanent||error.code)throw error;
   const clipNumber=Number(error.message.match(/Clip\s+(\d+)/i)?.[1]);
   throw new ImportValidationError(error.message,{storyNumber:s.storyNumber,title:s.title,section:'Production',clipNumber:clipNumber||undefined,
    line:clipNumber?s.clips[clipNumber-1]?._source?.line:s._source?.line});
  }
 });
 const reports=require('./ready_script_report');
 if(request.preflightOnly){
  const preview=parsed.map((s,i)=>reports.preflight(s,prepared[i]));
  if(!request.quiet)preview.forEach(r=>console.log(reports.reportText(r)));
  if(request.reportOut)fs.writeFileSync(path.resolve(request.reportOut),JSON.stringify(preview,null,2)+'\n');
  if(!request.quiet)console.log(`PREFLIGHT OK: ${preview.length} story/stories validated. No story packages or generation jobs created.`);
  return preview;
 }
 const root=path.resolve(request.out||path.join(__dirname,'stories'));fs.mkdirSync(root,{recursive:true});
 return prepared.map(({W,p,cast,story,warnings},i)=>{
  const s=parsed[i],key=semanticKey(s);
  if(!p.derived_video_preset&&!['fern-documentary','3d-zack-style','3d-motivational-red-green','heartwarming-cat-3d'].includes(s.preset)){delete key.characters;delete key.locations;key.clips.forEach(c=>{if(!c.shots.length)delete c.shots;});}
  const hash=crypto.createHash('sha256').update(JSON.stringify({s:key,aspect})).digest('hex').slice(0,10);
  const dir=path.join(root,`${W.slugify(s.title)}_ready_${hash}`),file=path.join(dir,`${path.basename(dir)}_story.json`);
  warnings=[...new Set([...(s.warnings||[]),...(warnings||[])])];
  warnings.forEach(w=>console.log(`WARNING: ${s.title}: ${w}`));
  const marker=path.join(dir,'READY_IMPORT_COMPLETE.json');
  if(fs.existsSync(file)&&fs.existsSync(marker)){
   reports.write(dir,s,prepared[i],origins.get(s).text);
   console.log(`Already imported; preserved existing package: ${file}\nPreflight: ${path.join(dir,'IMPORT_PREFLIGHT.txt')}`);return file;
  }
  if(!fs.existsSync(file)){
   W.writePackage(dir,p,story,cast);
   if(p.derived_video_preset)require('./reference_video_preset').writeRefs(dir,p,story,cast);
   if(story.zack_ready_import||story.motivational_ready_import){
    fs.writeFileSync(path.join(dir,'NARRATION_SCRIPT.txt'),story.scenes.map((sc,i)=>`Clip ${i+1}: ${sc.script_line}`).join('\n\n')+'\n');
    fs.writeFileSync(path.join(dir,'HOOK_GUIDE.txt'),(p.hook_line||'The opening narration and visible task contrast supply the hook.')+'\n\nDirect import preserves your supplied first line. Ask ChatGPT to improve the hook before importing; this file does not rewrite narration or generate extra clips.\n');
   }
  }
  const result=require('child_process').spawnSync(process.execPath,[path.join(__dirname,'story_to_agent_prompt.js'),file,'--aspect',aspect,'--seconds',String(s.seconds)],{cwd:__dirname,encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr||result.stdout||'Prompt export failed.');
  reports.write(dir,s,prepared[i],origins.get(s).text);
  fs.writeFileSync(marker,JSON.stringify({hash,clips:s.clips.length,seconds:s.seconds})+'\n');
  console.log(result.stdout.trim());console.log(`IMPORTED: ${file} (${s.clips.length} clips × ${s.seconds}s = ${s.clips.length*s.seconds}s; no AI writing)`);
  console.log(`Preflight: ${path.join(dir,'IMPORT_PREFLIGHT.txt')}\nRound-trip TXT: ${path.join(dir,'READY_SCRIPT_EXPORT.txt')}`);return file;
 });
}
function cli(argv){
 if(argv[0]==='--inspect'){
  const request=JSON.parse(fs.readFileSync(0,'utf8'));
  const reports=run({...request,preflightOnly:true,quiet:true});
  process.stdout.write(JSON.stringify(reports));return reports;
 }
 if(argv[0]==='--input'){
  const flag=name=>{const i=argv.indexOf(name);return i<0?undefined:argv[i+1];};
  const input=flag('--input');if(!input)throw new ImportValidationError('Supply --input story.txt or --input a-folder.');
  return run({[fs.statSync(input).isDirectory()?'folder':'file']:input,out:flag('--out'),preset:flag('--preset'),aspect:flag('--aspect')||'9:16',
   strict8x8:argv.includes('--strict-8x8'),preflightOnly:argv.includes('--preflight-only'),reportOut:flag('--report-out')});
 }
 return run(JSON.parse(fs.readFileSync(argv[0],'utf8').replace(/^\uFEFF/,'')));
}
if(require.main===module){try{cli(process.argv.slice(2));}catch(e){
 if(e.permanent||e instanceof SyntaxError){console.error('RECOVERY_REVIEW_REQUIRED: IMPORT_VALIDATION_FAILED\n'+(e.format?e.format():e.message));process.exitCode=2;}
 else {console.error('IMPORT_RUNTIME_FAILED: READY SCRIPT IMPORT FAILED: '+e.message);process.exitCode=1;}
}}
module.exports={parse,prepare,run,semanticKey,cli,ImportValidationError};
