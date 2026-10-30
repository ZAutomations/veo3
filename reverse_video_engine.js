'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{execFileSync}=require('child_process');
const C=require('./reverse_video_contract'),V=require('./gemini_video_source');
const ROOT=path.join(__dirname,'stories','_reverse_engineering'),VERSION=1;
const log=s=>console.log(`[${new Date().toTimeString().slice(0,8)}] ${s}`);
function save(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');fs.renameSync(tmp,file);}
async function digest(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
function validateRequest(r){
 if(!Array.isArray(r.videos)||r.videos.length<1||r.videos.length>3)throw Error('Select one to three local reference videos.');
 const videos=r.videos.map(v=>fs.realpathSync(v));if(new Set(videos).size!==videos.length)throw Error('Remove duplicate reference videos.');
 for(const file of videos)if(!/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file)||!fs.statSync(file).isFile()||fs.statSync(file).size>V.MAX_BYTES)throw Error('Use a supported video under 400 MB: '+path.basename(file));
 const opts={name:String(r.reverseName||'').trim().slice(0,100),clips:Number(r.reverseClips||8),aspect:r.reverseAspect||'9:16',mode:r.reverseMode||'auto',fps:Number(r.reverseFps||4),notes:String(r.reverseNotes||'').slice(0,8000),model:String(r.reverseModel||'').trim()};
 if(!Number.isInteger(opts.clips)||opts.clips<1||opts.clips>60||!['9:16','16:9','1:1'].includes(opts.aspect)||!['auto',...C.MODES].includes(opts.mode)||![2,4,8].includes(opts.fps)||opts.model&&!/^[a-zA-Z0-9._-]{1,100}$/.test(opts.model))throw Error('Invalid analysis settings.');
 return {videos,opts};
}
function probe(file){const data=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4e6}));const video=data.streams.find(s=>s.codec_type==='video');const duration=Number(data.format.duration||video?.duration);if(!video||!Number.isFinite(duration)||duration<=0)throw Error('Video has no measurable duration.');return {duration_seconds:duration,width:video.width,height:video.height,frame_rate:video.avg_frame_rate,video_codec:video.codec_name,audio_streams:data.streams.filter(s=>s.codec_type==='audio').map(s=>({codec:s.codec_name,sample_rate:s.sample_rate,channels:s.channels}))};}
function validateReport(data,meta){if(!Array.isArray(data.shots)||!data.shots.length||!data.audio||!data.style||!data.story)throw Error('Analysis omitted shots, audio, style or story.');let previous=0;for(const s of data.shots){if(typeof s.start_seconds!=='number'||typeof s.end_seconds!=='number'||s.start_seconds<previous-.1||s.end_seconds<=s.start_seconds||s.end_seconds>meta.duration_seconds+.5)throw Error('Analysis has invalid or overlapping shot timestamps.');previous=s.end_seconds;}const covered=data.shots.reduce((sum,s)=>sum+s.end_seconds-s.start_seconds,0);data.local_coverage={covered_seconds:covered,measured_duration:meta.duration_seconds,fraction:Math.min(1,covered/meta.duration_seconds),timing_is_model_estimate:true};if(covered/meta.duration_seconds<.8)throw Error('Shot analysis covers less than 80% of the video; incomplete report was not accepted.');return data;}
async function run(request,deps={}){
 if(!Array.isArray(request.videos)||request.videos.length<1||request.videos.length>3)throw Error('Select one to three reference files or YouTube links in total.');
 const local=[];
 for(const source of request.videos||[]){
  if(V.isYouTube(source)){
   const cache=path.join(deps.root||ROOT,'_youtube',crypto.createHash('sha256').update(source).digest('hex').slice(0,24));
   fs.mkdirSync(cache,{recursive:true});
   const existing=fs.readdirSync(cache).find(n=>/^source\.(mp4|webm|mkv|mov)$/i.test(n));
   log('Preparing YouTube reference for measured audiovisual analysis.');
   const downloaded=existing?{path:path.join(cache,existing)}:await (deps.downloadVideo||V.downloadVideo)(source,{dir:cache,log});
   local.push(downloaded.path);
  }else local.push(source);
 }
 request={...request,videos:local};
 const {videos,opts}=validateRequest(request),W=deps.writer||require('./write_story'),keys=deps.keys||W.apiKeys();if(!keys.length)throw Error('RECOVERY_REVIEW_REQUIRED: Add Gemini API keys in Settings first.');
 const hashes=await Promise.all(videos.map(digest));const id=crypto.createHash('sha256').update(JSON.stringify({VERSION,hashes,opts})).digest('hex').slice(0,24),dir=path.join(deps.root||ROOT,id);
 fs.mkdirSync(dir,{recursive:true});save(path.join(dir,'request.json'),{version:VERSION,id,videos,hashes,options:opts});
 const ring=new W.KeyRing(keys),uploads=new Map(),models=W.modelChain(opts.model||W.MODEL,W.DEFAULT_MODELS),transport=deps.transport||V;let calls=0;
 const redact=value=>keys.reduce((s,k)=>s.split(k).join('[redacted]'),String(value));
 log(`ANALYSIS_ID: ${id}. ${videos.length} reference video(s); output ${opts.clips} × 8s. Completed stages are reused by content hash.`);
 async function ask(stage,prompt,index,validate){
  const file=path.join(dir,stage+'.json');if(fs.existsSync(file)){log(stage+': restored completed stage.');const data=JSON.parse(fs.readFileSync(file,'utf8'));return validate?validate(data):data;}
  let last;
  for(let attempt=0;attempt<Math.min(9,models.length*Math.max(1,ring.size));attempt++){
   const key=ring.current,model=models[attempt%models.length];
   try{
    const parts=[];
    if(index!==undefined){const tag=keys.indexOf(key)+':'+index;let remote=uploads.get(tag);if(!remote){log(`${stage}: uploading ${path.basename(videos[index])} for the active API project.`);remote=await transport.uploadFile(key,videos[index],{log});uploads.set(tag,{...remote,key});remote=await transport.waitForActive(key,remote.name,{log});uploads.set(tag,{...remote,key});}else if(remote.state!=='ACTIVE'){remote=await transport.waitForActive(key,remote.name,{log});uploads.set(tag,{...remote,key});}parts.push({fileData:{fileUri:remote.uri,mimeType:remote.mimeType||V.mimeFor(videos[index])},videoMetadata:{fps:opts.fps}});}
    parts.push({text:prompt});log(`${stage}: analyzing with ${model} (${opts.fps} sampled frames/s for media stages).`);calls++;
    const response=await (deps.callApi||W.callApi)(key,model,{contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json',temperature:.2,maxOutputTokens:24000}});
    const raw=W.geminiText(response);save(path.join(dir,stage+'.response.txt'),redact(raw));const parsed=W.parseJson(raw);const result=validate?validate(parsed):parsed;save(file,result);return result;
   }catch(e){last=e;if(e.blockReason)throw Error('RECOVERY_REVIEW_REQUIRED: Provider declined this analysis; review the source or request. '+redact(e.message));log(stage+': attempt failed: '+redact(e.message).slice(0,500));if(W.isQuotaError(e)||W.isKeyRejected(e)){if(!ring.retire())break;}else ring.next();}
  }
  throw Error('RECOVERY_REVIEW_REQUIRED: Analysis stage '+stage+' failed after bounded attempts. Completed stages are preserved. '+redact(last?.message||''));
 }
 try{
  const reports=[];
  for(let i=0;i<videos.length;i++){
   const metadata=(deps.probe||probe)(videos[i]);save(path.join(dir,`video_${i+1}_metadata.json`),metadata);
   const report=await ask(`video_${i+1}_analysis`,C.reportPrompt(metadata),i,v=>validateReport(v,metadata));
   const audit=await ask(`video_${i+1}_audit`,C.auditPrompt(report),i,v=>{if(!Array.isArray(v.corrections)||!Array.isArray(v.uncertainties))throw Error('Audit must include corrections and uncertainties.');return v;});reports.push({source:i+1,metadata,report,audit});
  }
  const packageValidator=v=>{v.preset=C.validatePreset({...v.preset,...(opts.name?{name:opts.name}:{}),default_clips:opts.clips,scene_seconds:8,aspect_ratio:opts.aspect,...(opts.mode==='auto'?{}:{ready_script_mode:opts.mode})});if(!v.comparison||!v.production_bible||!Array.isArray(v.reference_prompts)||!v.quality_review)throw Error('Synthesis is incomplete.');return v;};
  const draft=await ask('synthesis',C.synthesisPrompt(reports,opts),undefined,packageValidator);
  const final=await ask('quality_review',`Review and correct this production package against the supplied evidence and audits. Resolve contradictions explicitly, remove unsupported precision and claims of hidden software. Preserve topic adaptation, output format, and measured-source/output-duration separation. Return the COMPLETE corrected package in the identical JSON shape, not a list of edits. Include quality_review.risks, unknowns, manual_checks. Evidence: ${JSON.stringify(reports)}\nDraft: ${JSON.stringify(draft)}`,undefined,packageValidator);
  const master=C.masterPrompt(final.preset);save(path.join(dir,'preset.json'),final.preset);save(path.join(dir,'MASTER_PROMPT.txt'),master);save(path.join(dir,'REPORT.json'),{id,options:opts,reports,...final});save(path.join(dir,'REFERENCE_PROMPTS.txt'),final.reference_prompts.map(r=>`${r.name} (${r.type})\n${r.prompt}`).join('\n\n'));
  save(path.join(dir,'complete.json'),{id,name:final.preset.name,completed_at:new Date().toISOString(),calls,preset_id:final.preset.id});log('Analysis complete. Review the saved reports and editable preset in Video Reverse Engineering, then Save preset.');return {id,dir};
 }finally{for(const remote of uploads.values()){try{await transport.removeFile(remote.key,remote.name,{log});}catch(e){log('Remote upload cleanup could not be confirmed; Google file expiration still applies.');}}}
}
if(require.main===module)run(JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''))).catch(e=>{console.error('VIDEO ANALYSIS FAILED: '+e.message);process.exitCode=1;});
module.exports={run,probe,digest,validateRequest,validateReport,ROOT,save};
