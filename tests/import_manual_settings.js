'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),I=require('../import_ready_script');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'import-manual-settings-'));
const base=`Title: How Does a Heartbeat Move Blood?
Preset: 3d-zack-style
Production profile: zetomate-flex
Clip seconds: 8
Estimated duration: 8 seconds
Characters:
None
Locations:
Heart model: A dimensional heart with chambers, valves and connected vessels.
Clip 1:
Narration: "How does a heartbeat move blood? Watch the chambers contract, the valves guide flow, and the circulation carry blood onward through the connected vessels."
Shot 1: 0–3 seconds — Push toward the contracting chambers of Heart model.
Shot 2: 3–5 seconds — Track from a chamber to the opening valve in Heart model.
Shot 3: 5–8 seconds — Follow the connected vessel away from the valve of Heart model.
Effect: A small arrow follows the described flow without obscuring the valve.
Sound: Quiet steady instrumental pulse and a soft arrow popup.
`;
const text='Story 1\n'+base+'\nStory 2\n'+base.replace('Preset: 3d-zack-style','Preset: intimacy-health-3d').replace('How Does a Heartbeat Move Blood?','Why Does Your Heart Beat?');
const oldLog=console.log;console.log=()=>{};
try{
 const files=I.run({text,out:root,videoModel:'Omni 1.2 Flash',videoResolution:'360p'});
 assert.equal(files.length,2);
 for(const file of files){const full=path.join(path.dirname(file),'manual_agent_batches','MANUAL_AGENT_FULL_STORY_ALL_BATCHES.txt');const s=fs.readFileSync(full,'utf8');assert(s.includes('Model Omni 1.2 Flash; duration 8 seconds; resolution 360p; aspect 9:16'));fs.writeFileSync(full,'STALE SETTINGS');}
 const storyBytes=files.map(file=>fs.readFileSync(file,'utf8'));
 const again=I.run({text,out:root,videoModel:'Omni 1.2 Flash',videoResolution:'1080p'});
 assert.deepEqual(again,files,'re-import must reuse existing packages');
 files.forEach((file,i)=>{assert.equal(fs.readFileSync(file,'utf8'),storyBytes[i],'manual settings refresh must preserve story/scene identity');const folder=path.join(path.dirname(file),'manual_agent_batches');const full=fs.readFileSync(path.join(folder,'MANUAL_AGENT_FULL_STORY_ALL_BATCHES.txt'),'utf8');assert(full.includes('resolution 1080p'));assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'MANUAL_AGENT_SETTINGS.json'),'utf8')).resolution,'1080p');assert(!full.includes('STALE SETTINGS'));});
}finally{console.log=oldLog;fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS: every imported story receives settings in manual batches/full-story TXT; cached re-import refreshes settings without rewriting story JSON or scene identity.');
