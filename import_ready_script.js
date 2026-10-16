// Deterministic local importer. No model calls and no media generation.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function parse(text,defaults={}){
 const rows=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/);
 const stories=[];let story=null,clip=null,section='';
 const unquote=value=>value.replace(/^(?:"([\s\S]*)"|“([\s\S]*)”)$/,(m,a,b)=>a??b).trim();
 function start(){story={title:'',preset:defaults.preset,seconds:Number(defaults.seconds||8),setting:'',characters:[],locations:[],clips:[]};stories.push(story);clip=null;section='';}
 for(const row of rows){
  const line=row.trim();if(!line)continue;
  if(/^Story\s+\d+\s*:?$/i.test(line)){start();continue;}
  if(!story)start();
  const heading=line.match(/^Clip\s+(\d+)\s*(?:[-–—]\s*(.*?))?\s*:\s*$/i);
  if(heading){const n=Number(heading[1]);if(n!==story.clips.length+1)throw Error(`${story.title}: clip numbers must start at 1 and be consecutive.`);clip={number:n,title:heading[2]||(['3d-zack-style','3d-motivational-red-green'].includes(story.preset)?`Clip ${n}`:`Conversation ${n}`),action:'',dialogue:[],shots:[]};story.clips.push(clip);section='';continue;}
  if(section&&!clip&&/^None\.?$/i.test(line)){section='';continue;}
  const field=line.match(/^([A-Za-z0-9 +_-]+):\s*(.*)$/);
  if(!field)throw Error(`Unrecognised line: ${line}. Use field labels and Clip N: headings.`);
  const key=field[1].toLowerCase(),value=field[2];
  if(clip){
   if(['sarah','george','female','male'].includes(key)){
    const speech=unquote(value);if(!speech)throw Error(`Clip ${clip.number}: empty dialogue.`);
    clip.dialogue.push({speaker:['sarah','female'].includes(key)?'Sarah':'George',line:speech});continue;
   }
   if(story.preset==='3d-motivational-red-green'&&['start state','end state'].includes(key)){const field=key.replace(' ','_');if(clip[field])throw Error(`Clip ${clip.number}: duplicate ${key}.`);clip[field]=value;continue;}
   if(key==='action'){clip.action=[clip.action,value].filter(Boolean).join(' ');continue;}
   if(key==='narration'){if(clip.narration)throw Error(`Clip ${clip.number}: duplicate narration.`);clip.narration=unquote(value);continue;}
   if(key==='effect'||key==='sound'){clip[key]=value;continue;}
   const shot=key.match(/^shot\s+(\d+)$/);
   if(shot){
    if(Number(shot[1])!==clip.shots.length+1)throw Error(`Clip ${clip.number}: shot numbers must be consecutive.`);
    const timing=value.match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:seconds?|s)\s*[-–—:]\s*(.+)$/i);
    if(!timing)throw Error(`Clip ${clip.number}: use Shot N: 0–3 seconds — visual description.`);
    clip.shots.push({start_seconds:Number(timing[1]),end_seconds:Number(timing[2]),visual:timing[3]});continue;
   }
   throw Error(`Clip ${clip.number}: unknown field ${field[1]}.`);
  }
  if(section&& !['title','preset','setting','clip seconds','duration','estimated duration','details','characters','locations'].includes(key)){
   if(story[section].some(item=>item.name.toLowerCase()===field[1].toLowerCase()))throw Error(`Duplicate ${section} name: ${field[1]}`);
   story[section].push({name:field[1],description:value});continue;
  }
  section='';
  if(key==='title')story.title=value;
  else if(key==='preset')story.preset=value;
  else if(key==='setting')story.setting=value;
  else if(story.preset==='3d-motivational-red-green'&&['left label','right label','footer start','footer end'].includes(key)){const field=key.replace(' ','_');if(story[field])throw Error(`Duplicate ${key}.`);story[field]=unquote(value);}
  else if(key==='clip seconds')story.seconds=Number(value);
  else if(key==='characters'||key==='locations'){
   section=key;if(value&&!/^None\.?$/i.test(value)&&story.preset==='3d-zack-style')throw Error(`Put named ${key} on separate lines below ${field[1]}:.`);
  }
  else if(key==='duration'||key==='estimated duration'){
   story.declaredDuration=Number(value.match(/^(\d+(?:\.\d+)?)\s*seconds?/i)?.[1])||null;
   const count=value.match(/(?:exactly\s+)?(\d+)\s+clips?\s+of\s+(\d+)\s+seconds?/i);
   if(count){story.declaredCount=Number(count[1]);story.seconds=Number(count[2]);}
  }else if(key!=='details')throw Error(`Unknown script field: ${field[1]}.`);
 }
 if(!stories.length)throw Error('Paste a ready script first.');
 for(const s of stories){
  const zack=s.preset==='3d-zack-style',motivational=s.preset==='3d-motivational-red-green';
  if(!s.title.trim()||(!motivational&&!s.setting.trim()&&!(zack&&s.locations.length)))throw Error('Every story needs Title: and Setting: (or named Locations: for Zack D).');
  if(![4,6,8,10].includes(s.seconds))throw Error(`${s.title}: choose 4, 6, 8 or 10 seconds per clip (depending on your video model).`);
  if(!s.clips.length)throw Error(`${s.title}: no clips supplied.`);
  for(const c of s.clips){
   if(zack){
    if(!c.narration||c.dialogue.length)throw Error(`Clip ${c.number}: Zack D requires Narration: and no character dialogue.`);
    if(c.shots.length<2||c.shots.length>4)throw Error(`Clip ${c.number}: requires two to four timed shots.`);
    let end=0;
    for(const shot of c.shots){if(Math.abs(shot.start_seconds-end)>.001||shot.end_seconds<=shot.start_seconds||shot.end_seconds>s.seconds)throw Error(`Clip ${c.number}: shot timings contain a gap, overlap or invalid endpoint.`);end=shot.end_seconds;}
    if(Math.abs(end-s.seconds)>.001)throw Error(`Clip ${c.number}: shots must cover all ${s.seconds} seconds.`);
    for(const key of ['effect','sound']){
     if(!c[key])continue;
     for(const m of c[key].matchAll(/(\d+(?:\.\d+)?)(?:\s*[-–—]\s*(\d+(?:\.\d+)?))?\s*seconds?/gi)){
      const start=Number(m[1]),finish=Number(m[2]||m[1]);if(start>s.seconds||finish>s.seconds||finish<start)throw Error(`Clip ${c.number}: ${key} timing is outside the clip.`);
     }
    }
   }else if(motivational){
    if(!c.narration||c.dialogue.length||c.shots.length)throw Error(`Clip ${c.number}: 3D Motivational requires Narration:, Start state:, Action: and End state:, with no dialogue or Shot fields.`);
   }else if(!c.dialogue.length||c.narration||c.shots.length)throw Error(`${s.title}: every dialogue clip needs labelled dialogue; narration/shots require Zack D.`);
  }
  if(motivational)require('./motivational_ready_script').validate(s);
  if(s.declaredCount&&s.declaredCount!==s.clips.length)throw Error(`${s.title}: declared clip count differs from the supplied clips.`);
  if(s.declaredDuration&&s.declaredDuration!==s.clips.length*s.seconds)throw Error(`${s.title}: declared duration differs from clip count × seconds.`);
 }
 return stories;
}
function writerFor(s,aspect){
 const old=process.argv;
 try{process.argv=[process.execPath,'write_story.js','--title',s.title,'--seconds',String(s.seconds),'--duration',String(s.seconds*s.clips.length),'--aspect',aspect];delete require.cache[require.resolve('./write_story')];return require('./write_story');}
 finally{process.argv=old;}
}
function prepare(s,aspect){
 const W=writerFor(s,aspect),p=W.loadPreset(s.preset);
 if(require('./motivational_metaphor').applies(p))return require('./motivational_ready_script').prepare(W,p,s,aspect);
 if(p.id==='3d-zack-style')return require('./zack_ready_script').prepare(W,p,s,aspect);
 if(p.narration_scope!=='dialogue'||!p.fixed_couple_names||(!require('./dog_couple').applies(p)&&!require('./realistic_couple').enabled(p)))throw Error('Ready script import currently supports realistic, Ghibli, stylized 3D, colorful cartoon and dog-couple Sarah/George dialogue presets, Zack D and 3D Motivational Red vs Green.');
 const cast=W.normaliseCast(p,[{name:'Sarah',gender:'female',type:'human'},{name:'George',gender:'male',type:'human'}]);
 const meta={description:s.title,moral:'',place_name:'Room',place_description:s.setting,place_prompt:`${p.location_medium||p.style}. Empty ${s.setting}. No people or animals, no text.`,blocking:p.blocking||''};
 const story=W.buildStory(p,cast,meta,s.clips.map(c=>({scene_title:c.title,dialogue:c.dialogue,narrative_context:c.action||'The two characters exchange these lines naturally in the established setting.',characters:['Sarah','George']})));
 story.script_import=true;story.imported_actions=s.clips.map(c=>c.action);
 // Keep imported actions available to the minimal prompt builder.
 story.scenes.forEach((scene,i)=>scene.imported_action=s.clips[i].action);
 const warnings=s.clips.flatMap(c=>{const words=c.dialogue.map(t=>t.line).join(' ').split(/\s+/).length;return words>s.seconds*3?[`Clip ${c.number}: ${words} words in ${s.seconds}s may be too long. Shorten the lines or use a longer clip.`]:[];});
 return {W,p,cast,story,warnings};
}
function run(request){
 const aspect=request.aspect||'9:16';if(!['9:16','16:9','1:1','Flow'].includes(aspect))throw Error('Invalid aspect ratio.');
 const parsed=parse(request.text,request);
 // Validate every story before creating any package.
 const prepared=parsed.map(s=>prepare(s,aspect));
 const root=path.resolve(request.out||path.join(__dirname,'stories'));fs.mkdirSync(root,{recursive:true});
 return prepared.map(({W,p,cast,story,warnings},i)=>{
  const s=parsed[i],key=JSON.parse(JSON.stringify(s));
  if(!['3d-zack-style','3d-motivational-red-green'].includes(s.preset)){delete key.characters;delete key.locations;key.clips.forEach(c=>{if(!c.shots.length)delete c.shots;});}
  const hash=crypto.createHash('sha256').update(JSON.stringify({s:key,aspect})).digest('hex').slice(0,10);
  const dir=path.join(root,`${W.slugify(s.title)}_ready_${hash}`),file=path.join(dir,`${path.basename(dir)}_story.json`);
  warnings.forEach(w=>console.log(`WARNING: ${s.title}: ${w}`));
  const marker=path.join(dir,'READY_IMPORT_COMPLETE.json');
  if(fs.existsSync(file)&&fs.existsSync(marker)){console.log(`Already imported; preserved existing package: ${file}`);return file;}
  if(!fs.existsSync(file)){
   W.writePackage(dir,p,story,cast);
   fs.writeFileSync(path.join(dir,'READY_SCRIPT_SOURCE.json'),JSON.stringify(s,null,2)+'\n');
   if(story.zack_ready_import||story.motivational_ready_import){
    fs.writeFileSync(path.join(dir,'NARRATION_SCRIPT.txt'),story.scenes.map((sc,i)=>`Clip ${i+1}: ${sc.script_line}`).join('\n\n')+'\n');
    fs.writeFileSync(path.join(dir,'HOOK_GUIDE.txt'),(p.hook_line||'The opening narration and visible task contrast supply the hook.')+'\n\nDirect import preserves your supplied first line. Ask ChatGPT to improve the hook before importing; this file does not rewrite narration or generate extra clips.\n');
   }
  }
  const result=require('child_process').spawnSync(process.execPath,[path.join(__dirname,'story_to_agent_prompt.js'),file,'--aspect',aspect,'--seconds',String(s.seconds)],{cwd:__dirname,encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr||result.stdout||'Prompt export failed.');
  fs.writeFileSync(marker,JSON.stringify({hash,clips:s.clips.length,seconds:s.seconds})+'\n');
  console.log(result.stdout.trim());console.log(`IMPORTED: ${file} (${s.clips.length} clips × ${s.seconds}s = ${s.clips.length*s.seconds}s; no AI writing)`);return file;
 });
}
if(require.main===module){try{run(JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')));}catch(e){console.error('READY SCRIPT IMPORT FAILED: '+e.message);process.exitCode=1;}}
module.exports={parse,prepare,run};
