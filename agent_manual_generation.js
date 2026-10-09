const fs=require('fs'),path=require('path');
function selectedClips(text,total){
    const result=[];
    for(const part of String(text||'').split(/[\s,]+/).filter(Boolean)){
        if(!/^\d+(?:-\d+)?$/.test(part))throw Error('Use clip numbers such as 2,8,6 or a range such as 3-5.');
        const [from,to=from]=part.split('-').map(Number);
        if(from<1||to<from||to>total)throw Error(`Clip numbers must be between 1 and ${total}.`);
        for(let n=from;n<=to;n++)if(!result.includes(n))result.push(n);
    }
    if(!result.length)throw Error('Select at least one clip.');return result;
}
function groups(total,{batch,clips,size=5}){
    if(clips)return selectedClips(clips,total).map(n=>({from:n,to:n}));
    const count=Math.ceil(total/size),start=Number(batch);
    if(!Number.isInteger(start)||start<1||start>count)throw Error(`Batch must be between 1 and ${count}.`);
    const result=[];for(let n=start;n<=count;n++)result.push({from:(n-1)*size+1,to:Math.min(n*size,total)});return result;
}
async function main(argv){
    const flag=name=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:undefined};
    const storyFile=path.resolve(flag('--story')||'');const story=JSON.parse(fs.readFileSync(storyFile));
    const project=flag('--project-url');if(!/^https:\/\/flow\.google\.com\/project\/[a-z0-9-]+(?:\/.*)?$/i.test(project||''))throw Error('Enter the existing Flow project URL.');
    const plan=groups(story.scenes.length,{batch:flag('--batch'),clips:flag('--clips')});
    const dir=path.join(path.dirname(storyFile),'manual_generation_'+Date.now());fs.mkdirSync(dir,{recursive:true});
    const checkpoint={project,story:storyFile,plan,completed:[],mode:'explicit manual selection; original batch checkpoint ignored'};
    const save=()=>fs.writeFileSync(path.join(dir,'progress.json'),JSON.stringify(checkpoint,null,2));save();
    const {spawn}=require('child_process');
    const run=(script,args)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(__dirname,script),...args],{cwd:__dirname,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(`${script} stopped with exit ${code}. No later selection was submitted. Progress: ${dir}`)));});
    console.log('MANUAL GENERATION: selected clips will be generated even if previous versions exist. Existing project and reference images are reused.');
    const requests=[];
    for(const [i,range]of plan.entries()){
        const file=path.join(dir,`request_${String(i+1).padStart(3,'0')}_clips_${range.from}_${range.to}.txt`);
        await run('story_to_agent_prompt.js',[storyFile,'--scene-from',String(range.from),'--scene-to',String(range.to),'--out',file,'--aspect',flag('--aspect')||story.aspect_ratio||'Flow',...(argv.includes('--flow-characters')?['--flow-characters']:[])]);
        requests.push({range,file});
    }
    console.log(`All ${requests.length} selected prompt files prepared: ${dir}`);
    if(argv.includes('--prepare-only'))return;
    for(const {range,file}of requests){
        console.log(`Submitting selected clips ${range.from}-${range.to}; waiting for completion before the next selection.`);
        const args=['--file',file,'--refs',storyFile,'--no-upload-refs','--project-url',project,'--cdp',flag('--cdp')||'9222','--paste','--auto-approve','--watch',flag('--watch')||'900','--manual-add-count',String(range.to-range.from+1),'--retry-rounds','0','--aspect',flag('--aspect')||story.aspect_ratio||'Flow'];
        // --settings is an inspection-only command that exits before pasting.
        // The normal generation path applies model/ratio/Never and saves them.
        if(flag('--video-model') && !/^flow$/i.test(flag('--video-model')))args.push('--video-model',flag('--video-model'));
        if(flag('--video-resolution'))args.push('--video-resolution',flag('--video-resolution'));
        args.push('--scene-seconds',String(flag('--scene-seconds')||story.scene_seconds||8));
        if(argv.includes('--flow-characters'))args.push('--flow-characters');
        await run('agent_mode.js',args);checkpoint.completed.push(range);save();
    }
    console.log(`Completed ${plan.length} manually selected request(s). Progress: ${dir}`);
}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error('MANUAL GENERATION STOPPED: '+e.message);process.exitCode=1;});
module.exports={selectedClips,groups};
