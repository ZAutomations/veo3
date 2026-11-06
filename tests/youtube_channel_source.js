'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const Y=require('../youtube_channel_source'),E=require('../reverse_video_engine');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'channel-analysis-'));
 try{
  assert.equal(Y.channelUrl('https://youtube.com/@example/shorts'),'https://www.youtube.com/@example');
  for(const u of ['https://youtube.com/watch?v=abcdefghijk','https://youtube.com.evil.test/@example','file:///tmp/x','https://user:pass@youtube.com/@x'])assert.throws(()=>Y.channelUrl(u));
  const entries=Array.from({length:8},(_,i)=>({id:'VideoRef00'+i,title:'Example '+i,view_count:(i+1)*100,duration:20,availability:'public'}));
  entries.push({id:'Private0001',title:'Private',availability:'private'});
  const inventory=await Y.discover({reverseChannelUrl:'https://youtube.com/@example',reverseChannelCount:5},{root,command:'mock',fetchMetadata:async(cmd,args)=>{assert(args.includes('--flat-playlist'));assert.equal(args.at(-1),'https://www.youtube.com/@example/shorts');return {channel:'Example channel',entries};}});
  assert.equal(inventory.videos.length,8);assert.deepEqual(inventory.selectedIds,['VideoRef007','VideoRef006','VideoRef005','VideoRef000','VideoRef001']);
  assert.throws(()=>Y.selection(root,'../escape',[]));assert.throws(()=>Y.selection(root,inventory.id,['not-found00']));
  assert.equal(Y.selection(root,inventory.id,[inventory.videos[3].id]).videos[0].id,inventory.videos[3].id);
  assert.equal(Y.autoSelect(inventory.videos.map(v=>({...v,views:null})),5).length,5);
  let calls=0,uploads=0,downloads=0;
  const preset={id:'reference-channel-test',name:'Channel Test',style:'Editorial paper cutouts.',direction:'Explain the topic using relevant paper-cut shapes.',camera:'Static paper plane and purposeful object moves.',sound_style:'Clear narrator and quiet clicks.',ready_script_mode:'narrated_visual',reference_cast:[],aspect_ratio:'9:16',default_clips:8,scene_seconds:8};
  const packageData={preset,comparison:{shared:[],variable:[]},production_bible:{visual:'Paper'},reference_prompts:[],quality_review:{risks:[],unknowns:[],manual_checks:[]}};
  const deps={root,keys:['fixture-key'],probe:()=>({duration_seconds:8,width:720,height:1280,audio_streams:[]}),
   downloadVideo:async(url,{dir})=>{downloads++;const file=path.join(dir,'source.mp4');fs.writeFileSync(file,url);return {path:file};},
   transport:{uploadFile:async()=>({name:'files/mock'+(++uploads),uri:'mock://media',mimeType:'video/mp4',state:'ACTIVE'}),waitForActive:async()=>({state:'ACTIVE'}),removeFile:async()=>{}},
   callApi:async(k,m,body)=>{calls++;const prompt=body.contents[0].parts.find(p=>p.text)?.text||'';
    const value=prompt.startsWith('Independently inspect')?{corrections:[],uncertainties:[]}:body.contents[0].parts.some(p=>p.fileData)?{shots:[{start_seconds:0,end_seconds:8}],audio:{speech_mode:'narration'},style:{medium:'Paper'},story:{hook:'Reveal'}}:packageData;
    return {candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]};}
  };
  const request={reverseChannelId:inventory.id,reverseChannelSelectedIds:inventory.selectedIds,reverseName:'Channel Test'};
  const result=await E.run(request,deps);assert.equal(downloads,5);assert.equal(uploads,5);assert.equal(calls,12);
  const sources=JSON.parse(fs.readFileSync(path.join(result.dir,'SOURCE_VIDEOS.json')));assert.equal(sources.length,5);assert(sources.every(s=>s.url.startsWith('https://www.youtube.com/watch?v=')));
  const report=JSON.parse(fs.readFileSync(path.join(result.dir,'REPORT.json')));assert.equal(report.reports.length,5);assert(report.reports.every(r=>r.source_url&&r.channel));
  await E.run(request,deps);assert.equal(calls,12,'retry reuses confirmed analysis stages');assert.equal(downloads,5,'retry reuses media for the saved exact selection');
  await assert.rejects(E.run({...request,videos:['unexpected.mp4']},deps),/not both/);
  console.log('PASS: channel URL validation, public inventory, popularity/recent sampling, exact manual selection, five-video audiovisual pipeline, source provenance and cached retry. Mock media/API only.');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
