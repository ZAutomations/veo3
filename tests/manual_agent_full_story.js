'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {writeManualAgentBatches,FULL_STORY_FILE}=require('../manual_agent_batches');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manual-full-story-'));
try {
 const file=path.join(dir,'story.json');
 fs.writeFileSync(file,JSON.stringify({title:'Manual export test',style:'Educational 3D animation',aspect_ratio:'9:16',scene_seconds:10,
  scenes:Array.from({length:8},(_,i)=>({scene_number:i+1,scene_title:`Beat ${i+1}`,script_line:`Unique narration for scene ${i+1}.`,narrative_context:`A model moves toward marker ${i+1}.`,characters:[]}))}));
 const result=writeManualAgentBatches(file,{videoModel:'Omni 1.2 Flash',videoResolution:'360p'});
 assert.equal(result.count,2);
 assert.equal(path.basename(result.fullStoryFile),FULL_STORY_FILE);
 const combined=fs.readFileSync(result.fullStoryFile,'utf8');
 const batches=fs.readdirSync(result.folder).filter(n=>/^MANUAL_AGENT_BATCH_\d/.test(n)).sort();
 let previous=-1;
 for(const name of batches){const content=fs.readFileSync(path.join(result.folder,name),'utf8');const at=combined.indexOf(content);assert(at>previous,'Complete batch instructions must appear verbatim and in order');previous=at;}
 assert(combined.includes('Scenes: 1-6 of 8'));
 assert(combined.includes('Scenes: 7-8 of 8'));
 for(let i=1;i<=8;i++)assert(combined.includes(`Unique narration for scene ${i}.`));
 assert.equal((combined.match(/VIDEO GENERATION SETTINGS:/g)||[]).length,10,'one settings header per batch plus every scene');
 assert.equal((combined.match(/resolution 360p/g)||[]).length,10);
 assert(combined.includes('Model Omni 1.2 Flash; duration 10 seconds'));
 assert(combined.includes('DURATION PARAMETER CHECK'));
 const other=writeManualAgentBatches(file,{videoModel:'Omni 1.2 Flash',videoResolution:'720p'});
 assert(fs.readFileSync(other.fullStoryFile,'utf8').includes('resolution 720p'),'explicit resolution must remain editable');
 const high=writeManualAgentBatches(file,{videoModel:'Omni 1.2 Flash',videoResolution:'1080p'});
 assert(fs.readFileSync(high.fullStoryFile,'utf8').includes('resolution 1080p'));
 const remembered=writeManualAgentBatches(file,{videoModel:'Omni 1.2 Flash'});
 assert(fs.readFileSync(remembered.fullStoryFile,'utf8').includes('resolution 1080p'),'story-specific manual resolution survives a later export');
 assert(fs.readFileSync(path.join(result.folder,'MANUAL_AGENT_BATCHES.txt'),'utf8').includes(FULL_STORY_FILE));
 console.log('PASS: all eight scenes and complete six/two-scene batch instructions exported verbatim in one combined TXT.');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
