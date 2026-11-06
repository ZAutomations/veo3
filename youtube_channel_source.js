'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{execFile}=require('child_process');
function channelUrl(value){
 let u;try{u=new URL(String(value||''));}catch{throw Error('Enter a valid public YouTube channel URL.');}
 if(u.protocol!=='https:'||!['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)||u.username||u.password||u.port)throw Error('Use an https://www.youtube.com channel URL.');
 const match=u.pathname.match(/^\/(\@[\w.%-]+|(?:channel|c|user)\/[\w.%-]+)(?:\/(?:videos|shorts|featured))?\/?$/);
 if(!match)throw Error('Use a channel handle or /channel/ URL, not an individual video or playlist.');
 return 'https://www.youtube.com/'+match[1];
}
function metadata(command,args){return new Promise((resolve,reject)=>execFile(command,args,{windowsHide:true,timeout:90000,maxBuffer:12*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>{
 if(error)return reject(Error('YouTube channel discovery failed: '+String(stderr||error.message).slice(0,500)));
 try{resolve(JSON.parse(stdout));}catch{reject(Error('YouTube did not return usable channel metadata.'));}
}));}
function normalize(feed,format){
 return (feed.entries||[]).flatMap((entry,index)=>{
  const id=String(entry.id||'');if(!/^[A-Za-z0-9_-]{11}$/.test(id)||!entry.title||/\[(?:private|deleted) video\]/i.test(entry.title)||['private','premium_only','subscriber_only','needs_auth'].includes(entry.availability)||entry.is_live||entry.live_status==='is_live')return [];
  return [{id,title:String(entry.title).slice(0,250),url:'https://www.youtube.com/watch?v='+id,format,views:Number.isFinite(entry.view_count)?entry.view_count:null,duration:Number.isFinite(entry.duration)?entry.duration:null,uploadDate:entry.upload_date||null,recentRank:index}];
 });
}
function autoSelect(videos,count=5){
 const popular=videos.filter(v=>v.views!==null).sort((a,b)=>b.views-a.views||a.recentRank-b.recentRank);
 const recent=[...videos].sort((a,b)=>a.recentRank-b.recentRank),chosen=[];
 const add=v=>{if(v&&!chosen.some(c=>c.id===v.id))chosen.push(v);};
 popular.slice(0,Math.ceil(count*.6)).forEach(add);
 for(const v of recent){if(chosen.length>=count)break;add(v);}
 return chosen.slice(0,count);
}
async function discover(request,{root,fetchMetadata=metadata,command}={}){
 const channel=channelUrl(request.reverseChannelUrl),format=request.reverseChannelFormat||'shorts',count=Number(request.reverseChannelCount||5);
 if(!['shorts','videos'].includes(format)||!Number.isInteger(count)||count<1||count>10)throw Error('Choose Shorts or long videos and 1–10 references.');
 command=command||require('./gemini_video_source').ytDlpPath();if(!command)throw Error('Install yt-dlp to discover public channel videos.');
 const args=['--flat-playlist','--dump-single-json','--skip-download','--playlist-end','50','--no-warnings','--socket-timeout','20',channel+'/'+format];
 const feed=await fetchMetadata(command,args),videos=normalize(feed,format);
 if(!videos.length)throw Error('No accessible video candidates found in this channel tab. Try the other format or individual public video links.');
 const selected=autoSelect(videos,count),discoveredAt=new Date().toISOString();
 const id=crypto.randomBytes(12).toString('hex');
 const result={id,channelUrl:channel,channelName:feed.channel||feed.uploader||feed.title||channel,format,discoveredAt,videos,selectedIds:selected.map(v=>v.id),requestedCount:count,
  selectionNote:'Popular means highest visible view counts within the fetched candidates (up to 50), not a verified all-time channel ranking. Recent follows the channel tab order; missing counts/dates stay unknown. Only selected videos will undergo audiovisual analysis.'};
 const folder=path.join(root,'_channels');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,id+'.json'),JSON.stringify(result,null,2));
 return result;
}
function selection(root,id,ids){
 if(!/^[a-f0-9]{24}$/.test(String(id)))throw Error('Discover a channel first.');
 const plan=JSON.parse(fs.readFileSync(path.join(root,'_channels',id+'.json'),'utf8'));
 if(!Array.isArray(ids)||!ids.length||ids.length>10||new Set(ids).size!==ids.length)throw Error('Select 1–10 unique channel videos.');
 const videos=ids.map(id=>{const v=plan.videos.find(v=>v.id===id);if(!v)throw Error('Selected video was not in the discovered channel inventory.');return v;});
 return {...plan,videos,selectedIds:ids};
}
module.exports={channelUrl,normalize,autoSelect,discover,selection};
if(require.main===module){let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{try{const request=JSON.parse(input);const root=path.join(__dirname,'stories','_reverse_engineering');process.stdout.write(JSON.stringify(await discover(request,{root})));}catch(e){console.error(e.message);process.exitCode=1;}});}
