'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const I=require('../import_ready_script'),hybrid=require('../world_politics_ready_script');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'world-politics-import-'));
const originalLog=console.log;console.log=()=>{};
try{
 for(const seconds of [4,6,8,10]){
  const modes=['MAP','RECONSTRUCTION','MAP','EXPLAINER'];
  const text=`Story 1\nTitle: How a Trade Route Connects Two Ports\nPreset: ${hybrid.ID}\nClip seconds: ${seconds}\nEstimated duration: ${seconds*4} seconds\nStory brief: Local synthetic production fixture, not current reporting.\nSources: Test fixture only; cutoff not applicable; https://example.org/fixture\nSetting: Two illustrative ports\nCharacters: None\nLocations:\nPort region: Coastlines and two port markers.\n\n`+modes.map((mode,i)=>`Clip ${i+1}:\nNarration: "The route connects these two ports, while this diagram explains the relationship."\nShot 1: 0–${seconds/2} seconds — [${mode}] Track toward the first port marker.\nShot 2: ${seconds/2}–${seconds} seconds — [${mode}] Pan to the second marker and reveal the connection.\nEffect: None\nSound: Quiet instrumental pulse; label pop at the marker reveal.\n`).join('\n');
  const source=I.parse(text)[0];
  assert.throws(()=>hybrid.validate({...source,sources:''}),/Sources/);
  const invalid=JSON.parse(JSON.stringify(source));invalid.clips[0].shots[0].visual='Unmarked generic visual';
  assert.throws(()=>hybrid.validate(invalid),/start every Shot/);
  const wrongMix=JSON.parse(JSON.stringify(source));wrongMix.clips.forEach(c=>c.shots.forEach(s=>s.visual=s.visual.replace(/\[[A-Z]+\]/,'[MAP]')));
  assert.throws(()=>hybrid.validate(wrongMix),/50%/);
  const [file]=I.run({text,out:path.join(root,String(seconds)),quiet:true});
  const story=JSON.parse(fs.readFileSync(file));
  assert(story.politics_ready_import);assert(!story.fern_ready_import);assert.equal(story.scene_seconds,seconds);assert.equal(story.flow_voice,'Alnilam');
  assert.equal(story.scenes.length,4);assert(story.imported_sources.includes('example.org'));
  const folder=path.dirname(file),agent=fs.readFileSync(path.join(folder,'agent_prompt.txt'),'utf8');
  for(const term of ['HYBRID VISUAL IDENTITY','editorial whiteboard','FACTUAL BASIS','[MAP]','[RECONSTRUCTION]','[EXPLAINER]'])assert(agent.includes(term),term);
  assert(fs.readFileSync(path.join(folder,'clip_prompts/clip_001.txt'),'utf8').includes('HYBRID VISUAL IDENTITY'));
  assert(fs.readFileSync(path.join(folder,'thumbnail_prompt_vertical.txt'),'utf8').includes('factual world-politics'));
 }
}finally{console.log=originalLog;fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS: hybrid imports at 4/6/8/10 seconds, mix/source validation, exact medium markers, narrator, Agent and individual exports, thumbnail. No API or generation calls.');
