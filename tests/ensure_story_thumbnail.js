const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {ensure}=require('../ensure_story_thumbnail');
(async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ensure-thumbnail-'));
 fs.writeFileSync(path.join(folder,'one_story.json'),JSON.stringify({preset_id:'geography-map'}));
 let connected=0;const connect=async()=>{connected++;throw Error('fixture connection reached');};
 fs.writeFileSync(path.join(folder,'thumbnail_downloaded.jpg'),Buffer.concat([Buffer.from([0xff,0xd8]),Buffer.alloc(3000)]));
 assert((await ensure(folder,{connect})).endsWith('.jpg'));assert.equal(connected,0);
 fs.unlinkSync(path.join(folder,'thumbnail_downloaded.jpg'));
 await assert.rejects(()=>ensure(folder,{connect}),/No saved Flow project/);assert.equal(connected,0);
 fs.mkdirSync(path.join(folder,'clips'));
 fs.writeFileSync(path.join(folder,'clips','renamed.mp4'),'verified-fixture');
 const sha256=require('crypto').createHash('sha256').update('verified-fixture').digest('hex');
 fs.writeFileSync(path.join(folder,'agent_upscaled_fixture.json'),JSON.stringify({project:'https://flow.google.com/project/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',clips:[{file:'old.mp4',sha256}]}));
 await assert.rejects(()=>ensure(folder,{connect}),/fixture connection reached/);assert.equal(connected,1,'renamed clips retain project association by verified bytes');
 console.log('PASS: existing thumbnail avoids browser; missing project blocks; renamed clips recover project through download hash.');
})().catch(e=>{console.error(e);process.exitCode=1});
