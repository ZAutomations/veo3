// Stateful ready-script parser. No model calls, file writes or generation.
class ImportValidationError extends Error {
 constructor(message,context={}) {
  super(message);this.name='ImportValidationError';this.code='IMPORT_VALIDATION_FAILED';this.permanent=true;
  Object.assign(this,context);
 }
 format(){return ['IMPORT VALIDATION FAILED',`Story: ${this.storyNumber||'(unnumbered)'}${this.title?' — '+this.title:''}`,
  `Section: ${this.section||'Metadata'}`,this.clipNumber?`Clip: ${this.clipNumber}`:'',this.field?`Field: ${this.field}`:'',
  this.line?`Line: ${this.line}`:'',this.message,'No video-generation jobs were started.'].filter(Boolean).join('\n');}
}
const TOP=new Set(['title','preset','setting','clip seconds','duration','estimated duration','details','characters','locations',
 'continuity','production profile','location name','left label','right label','footer start','footer end']);
const unquote=value=>String(value).trim().replace(/^(?:"([\s\S]*)"|“([\s\S]*)”)$/,(m,a,b)=>a??b).trim();
const words=text=>(String(text).match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)||[]).length;

function parse(text,defaults={}) {
 const raw=String(text||'').replace(/^\uFEFF/,''),rows=raw.split(/\r\n|\n|\r/);
 const stories=[],customCache=new Map();let story=null,clip=null,section='',last=null;
 const custom=id=>{if(!customCache.has(id))customCache.set(id,require('./write_story').presetLists().find(p=>p.id===id&&p.derived_video_preset));return customCache.get(id);};
 function start(number,line){
  story={title:'',preset:defaults.preset,seconds:Number(defaults.seconds||8),setting:'',characters:[],locations:[],clips:[]};
  if(number!==null)story.storyNumber=number;
  Object.defineProperties(story,{_source:{value:{line,fields:{},rows},enumerable:false},warnings:{value:[],enumerable:false}});
  stories.push(story);clip=null;section='';last=null;
 }
 function fail(message,line,field,ctx={}){throw new ImportValidationError(message,{storyNumber:story?.storyNumber,title:story?.title,
  section:clip?'Clips':section||'Metadata',clipNumber:clip?.number,line,field,...ctx});}
 function seen(target,key,line,label){
  if(target._source.fields[key])fail(`Duplicate ${label||key}. Keep one value instead of overwriting the earlier field.`,line,label||key);
  target._source.fields[key]=line;
 }
 function assign(target,key,value,line,label){seen(target,key,line,label);target[key]=value;last={target,key};}
 for(let index=0;index<rows.length;index++){
  const lineNo=index+1,line=rows[index].trim();if(!line)continue;
  const header=line.match(/^Story\s+(\d+)\s*:?$/i);
  if(header){if(Number(header[1])<1)fail('Story number must be positive.',lineNo,'Story');start(Number(header[1]),lineNo);continue;}
  if(!story)start(null,lineNo);
  const heading=line.match(/^Clip\s+(\d+)\s*(?:[-–—]\s*(.*?))?\s*:\s*$/i);
  if(heading){
   const n=Number(heading[1]);if(n!==story.clips.length+1)fail('Clip numbers must start at 1 and be consecutive and unique.',lineNo,'Clip');
   clip={number:n,title:heading[2]||(['3d-zack-style','3d-motivational-red-green','heartwarming-cat-3d'].includes(story.preset)?`Clip ${n}`:`Conversation ${n}`),action:'',dialogue:[],shots:[]};
   Object.defineProperty(clip,'_source',{value:{line:lineNo,fields:{},shots:[]},enumerable:false});
   story.clips.push(clip);section='';last=null;continue;
  }
  if(section&&!clip&&/^None\.?$/i.test(line)){section='';last=null;continue;}
  // A section entry can have punctuation, Unicode, spaces or a slash in its
  // name. Reserved metadata is handled before arbitrary location entries.
  const field=line.match(/^([^:\r\n]+?)\s*:\s*(.*)$/);
  if(!field){
   if(last){last.target[last.key]+=' '+line;continue;}
   fail(`Unrecognised line: ${line}. Use field labels and Clip N: headings.`,lineNo);
  }
  const label=field[1].trim(),key=label.toLowerCase().replace(/\s+/g,' '),value=field[2];
  if(clip){
   const p=custom(story.preset),speaker=p?.reference_cast?.find(c=>c.name.toLowerCase()===key);
   if(speaker||['sarah','sam','george','female','male'].includes(key)){
    const speech=unquote(value);if(!speech)fail('Empty dialogue.',lineNo,label);
    const turn={speaker:speaker?.name||(['sarah','female'].includes(key)?'Sarah':'SAM'),line:speech};clip.dialogue.push(turn);last={target:turn,key:'line'};continue;
   }
   if((p||['3d-motivational-red-green','heartwarming-cat-3d'].includes(story.preset))&&['start state','end state'].includes(key)){
    assign(clip,key.replace(' ','_'),value,lineNo,label);continue;
   }
   if(key==='action'){clip.action=[clip.action,value].filter(Boolean).join(' ');last={target:clip,key:'action'};continue;}
   if(key==='narration'){assign(clip,'narration',value,lineNo,label);continue;}
   if(key==='effect'||key==='sound'||((p||story.preset==='heartwarming-cat-3d')&&key==='audio')){
    assign(clip,key==='audio'?'sound':key,value,lineNo,label);continue;
   }
   const shot=key.match(/^shot\s+(\d+)$/);
   if(shot){
    if(Number(shot[1])!==clip.shots.length+1)fail('Shot numbers must start at 1 and be consecutive and unique.',lineNo,label);
    // U+FFFD is accepted ONLY in the two timing-separator positions, with a
    // visible warning; narration and descriptive text are never guessed.
    const timing=value.match(/^(\d+(?:\.\d+)?)\s*[-–—\uFFFD]\s*(\d+(?:\.\d+)?)\s*(?:seconds?|s)\s*[-–—:\uFFFD]\s*(.*)$/i);
    if(!timing)fail('Use Shot N: 0–3 seconds — a concrete visible action.',lineNo,label);
    if(timing[0].includes('\uFFFD'))story.warnings.push(`Line ${lineNo}, Clip ${clip.number}: damaged timing separators were interpreted as dashes. Re-export the source TXT as UTF-8.`);
    const item={start_seconds:Number(timing[1]),end_seconds:Number(timing[2]),visual:timing[3]};
    clip.shots.push(item);clip._source.shots.push(lineNo);last={target:item,key:'visual'};continue;
   }
   fail(`unknown field ${label} in Clip ${clip.number}. Supported fields include Narration, Shot N, Effect and Sound.`,lineNo,label);
  }
  if(section&&!TOP.has(key)){
   if(story[section].some(item=>item.name.toLowerCase()===label.toLowerCase()))fail(`Duplicate ${section} name: ${label}.`,lineNo,label);
   const entry={name:label,description:value};Object.defineProperty(entry,'_sourceLine',{value:lineNo,enumerable:false});story[section].push(entry);last={target:entry,key:'description'};continue;
  }
  if(key==='continuity'){
   assign(story,'continuity',value,lineNo,label);continue;
  }
  section='';last=null;
  if(['title','preset','setting','details'].includes(key)){assign(story,key,value,lineNo,label);continue;}
  if(key==='production profile'){
   if(!/^(?:zetomate[- ]8[x×]8|strict[- ]8[x×]8|8[x×]8)$/i.test(value))fail('Supported production profile: zetomate-8x8.',lineNo,label);
   assign(story,'production_profile','zetomate-8x8',lineNo,label);continue;
  }
  if(story.preset==='heartwarming-cat-3d'&&key==='location name'){assign(story,'location_name',value,lineNo,label);continue;}
  if(story.preset==='3d-motivational-red-green'&&['left label','right label','footer start','footer end'].includes(key)){
   assign(story,key.replace(' ','_'),unquote(value),lineNo,label);continue;
  }
  if(key==='clip seconds'){
   seen(story,'seconds',lineNo,label);story.seconds=Number(value);continue;
  }
  if(key==='characters'||key==='locations'){
   seen(story,key,lineNo,label);section=/^None\.?$/i.test(value)?'':key;
   if(value&&!/^None\.?$/i.test(value)&&story.preset==='3d-zack-style')fail(`Put named ${key} on separate lines below ${label}:.`,lineNo,label);
   continue;
  }
  if(key==='duration'||key==='estimated duration'){
   seen(story,'declaredDuration',lineNo,label);
   const duration=value.match(/^(\d+(?:\.\d+)?)\s*seconds?/i);
   const count=value.match(/(?:exactly\s+)?(\d+)\s+clips?\s+of\s+(\d+)\s+seconds?/i);
   if(!duration&&!count)fail('Use Estimated duration: 64 seconds, or Duration: 8 clips of 8 seconds.',lineNo,label);
   story.declaredDuration=duration?Number(duration[1]):null;
   if(count){story.declaredCount=Number(count[1]);story.seconds=Number(count[2]);}
   continue;
  }
  fail(`Unknown script field: ${label}.`,lineNo,label);
 }
 if(!stories.length)throw new ImportValidationError('Paste a ready script first.');
 const strictNumbers=new Set();
 for(const s of stories){
  story=s;clip=null;section='Metadata';
  const p=custom(s.preset),zack=s.preset==='3d-zack-style',motivational=s.preset==='3d-motivational-red-green',cat=s.preset==='heartwarming-cat-3d';
  const strict=zack&&(defaults.strict8x8===true||s.production_profile==='zetomate-8x8');
  if(strict)s.production_profile='zetomate-8x8';
  if(!s.title.trim()||(!motivational&&!s.setting.trim()&&!(zack&&s.locations.length)))fail('Every story needs Title: and Setting: (or named Locations: for Zack D).',s._source.line,'Title / Locations');
  for(const kind of ['characters','locations'])for(const entry of s[kind]){entry.description=entry.description.trim();if(!entry.description)fail(`Provide a description for ${entry.name}.`,entry._sourceLine,entry.name,{section:kind});}
  if(!s.preset)fail('Choose or supply a valid Preset:.',s._source.line,'Preset');
  if(![4,6,8,10].includes(s.seconds))fail('Choose 4, 6, 8 or 10 seconds per clip.',s._source.fields.seconds||s._source.line,'Clip seconds');
  if(!s.clips.length)fail('No clips supplied.',s._source.line,'Clips');
  if(s.production_profile&&!zack)fail('The zetomate-8x8 profile applies to 3d-zack-style.',s._source.line,'Production profile');
  if(strict){
   if(!s.storyNumber)fail('Strict 8×8 scripts need a positive Story N heading.',s._source.line,'Story');
   if(strictNumbers.has(s.storyNumber))fail('Duplicate story number in this strict production batch.',s._source.line,'Story');
   strictNumbers.add(s.storyNumber);
   if(s.seconds!==8||s.clips.length!==8)fail(`Strict 8×8 production requires exactly 8 clips of 8 seconds; received ${s.clips.length} clips × ${s.seconds}s.`,s._source.line,'Clips');
  }
  for(const c of s.clips){
   clip=c;
   if(c.narration!==undefined)c.narration=unquote(c.narration);
   for(const turn of c.dialogue)turn.line=unquote(turn.line);
   if(zack){
    if(!c.narration||c.dialogue.length)fail('Zack D requires Narration: and no character dialogue.',c._source.fields.narration||c._source.line,'Narration');
    if(strict?c.shots.length!==3:c.shots.length<2||c.shots.length>4)fail(strict?'Strict 8×8 clips require exactly three timed shots.':'Requires two to four timed shots.',c._source.line,'Shots');
    let end=0;
    for(let i=0;i<c.shots.length;i++){
     const shot=c.shots[i];shot.visual=shot.visual.trim();
     if(!shot.visual)fail('Provide a concrete shot description.',c._source.shots[i],`Shot ${i+1}`);
     if(Math.abs(shot.start_seconds-end)>.001||shot.end_seconds<=shot.start_seconds||shot.end_seconds>s.seconds)fail('Shot timings contain a gap, overlap or invalid endpoint.',c._source.shots[i],`Shot ${i+1}`);
     end=shot.end_seconds;
     if(/^(?:use a motivated tracking move[.!]?|resolve one scientific question on screen[.!]?|make the explanation visible[.!]?)$/i.test(shot.visual.trim()))s.warnings.push(`Clip ${c.number}, Shot ${i+1}: generic direction does not identify a visible subject or mechanism; review the visual before generation.`);
    }
    if(Math.abs(end-s.seconds)>.001)fail(`Shots must cover all ${s.seconds} seconds.`,c._source.line,'Shots');
    for(const key of ['effect','sound']){
     if(strict&&!String(c[key]||'').trim())fail(`Strict 8×8 clips require ${key==='effect'?'Effect: (use None if unnecessary)':'Sound: instructions'}.`,c._source.line,key);
     if(!c[key])continue;
     for(const m of c[key].matchAll(/(-?\d+(?:\.\d+)?)(?:\s*[-–—\uFFFD]\s*(-?\d+(?:\.\d+)?))?\s*(?:seconds?|s)\b/gi)){
      const start=Number(m[1]),finish=Number(m[2]||m[1]);
      if(start<0||finish<0||start>s.seconds||finish>s.seconds||finish<start)fail(`${key} timing is outside the clip duration.`,c._source.fields[key],key);
     }
    }
    const count=words(c.narration);
    if(count<16||count>20)s.warnings.push(`Clip ${c.number}: ${count} narration words; preferred 16–20${count>22?', above the 22-word target':''}. Estimated ${Math.round(count/2.5*10)/10}s at 150 words/minute; actual delivery may differ. Narration was preserved.`);
   }else if(motivational){
    if(!c.narration||c.dialogue.length||c.shots.length)fail('3D Motivational requires Narration, Start state, Action and End state, with no dialogue or Shot fields.',c._source.line,'Clip');
   }else if(!p&&!cat&&(!c.dialogue.length||c.narration||c.shots.length))fail('Every dialogue clip needs labelled dialogue; narration/shots require Zack D.',c._source.line,'Dialogue');
  }
  clip=null;
  try{
   if(p)require('./reference_video_preset').validate(s,p);
   if(cat)require('./heartwarming_cat').validate(s);
   if(motivational)require('./motivational_ready_script').validate(s);
  }catch(e){if(e.permanent)throw e;fail(e.message,s._source.line,'Production');}
  if(s.declaredCount&&s.declaredCount!==s.clips.length)fail('declared clip count differs from the supplied clips.',s._source.fields.declaredDuration,'Duration');
  if(s.declaredDuration!==undefined&&s.declaredDuration!==null&&s.declaredDuration!==s.clips.length*s.seconds)fail('declared duration differs from clip count × seconds.',s._source.fields.declaredDuration,'Estimated duration');
 }
 return stories;
}

module.exports={parse,ImportValidationError,words,unquote};
