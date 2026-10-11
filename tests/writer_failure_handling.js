const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {spawnSync}=require('child_process');
const {writingCall}=require('../writing_progress');
const W=require('../write_story');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'writer-failure-test-'));
const blocked=Object.assign(Error('blocked by the API: PROHIBITED_CONTENT'),{blockReason:'PROHIBITED_CONTENT'});
(async()=>{
 let calls=0;
 await assert.rejects(writingCall(temp,'Ordinary adult conversation',async()=>{calls++;throw blocked;},()=>true),/PROHIBITED_CONTENT/);
 assert.equal(calls,1);
 const folder=path.join(temp,'writing_progress'),files=fs.readdirSync(folder);
 assert(files.some(f=>f.endsWith('.request.txt')));
 assert(files.some(f=>f.endsWith('.failure.json')));
 assert(!files.some(f=>!f.endsWith('.failure.json')&&f.endsWith('.json')));
 assert.throws(()=>W.geminiText({promptFeedback:{blockReason:'PROHIBITED_CONTENT'}}),e=>e.blockReason==='PROHIBITED_CONTENT');
 assert.throws(()=>W.geminiText({candidates:[{finishReason:'SAFETY'}]}),e=>e.blockReason==='SAFETY');
 const preload=path.join(temp,'block_response.js'),counter=path.join(temp,'calls.txt');
 fs.writeFileSync(preload,`const fs=require('fs');global.fetch=async()=>{fs.appendFileSync(${JSON.stringify(counter)},'called\\n');return {ok:true,text:async()=>JSON.stringify({promptFeedback:{blockReason:'PROHIBITED_CONTENT'}})};};`);
 const child=spawnSync(process.execPath,['--require',preload,path.resolve('write_story.js'),
  '--title','A calm relationship conversation','--detail','Sarah: Communication matters. George: Respect matters too.',
  '--preset','relationship-dialogue-ghibli','--seconds','8','--duration','40','--key','fake-test-key',
  '--transport','auto','--out',path.join(temp,'output')],{encoding:'utf8',timeout:15000});
 assert.equal(child.status,1,child.stderr);
 assert(child.stderr.includes('PROHIBITED_CONTENT'));
 assert(!child.stderr.includes('Assertion failed'));
 assert.equal(fs.readFileSync(counter,'utf8').trim().split('\n').length,1);
 assert(!child.stdout.includes('handing this call'));
 const badTiming=spawnSync(process.execPath,['--require',preload,path.resolve('write_story.js'),'--title','Timing check','--preset','relationship-dialogue-ghibli','--seconds','1'],{encoding:'utf8',timeout:5000});
 assert.equal(badTiming.status,1);
 assert(badTiming.stderr.includes('Nothing was sent'));
 assert.equal(fs.readFileSync(counter,'utf8').trim().split('\n').length,1);
 console.log('PASS: rejected requests are diagnosed, not cached/retried; normal CLI failure exit; 1-second timing rejected before network.');
})().catch(e=>{console.error(e);process.exitCode=1;});
