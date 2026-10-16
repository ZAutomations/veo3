const assert=require('assert');
const MT=require('../mention_target'),P=require('../reference_picker_images');
assert.deepEqual(MT.distinctMentions(MT.extractMentions('Use @George, @Sarah and @Sunlit Minimalist Living Room.', ['george','sarah','Sunlit Minimalist Living Room'])),['George','Sarah','Sunlit Minimalist Living Room']);
(async()=>{
 let chips=0,clicks=0;
 const page={evaluate:async fn=>{
  if(fn.name==='selectionState')return {chips,canConfirm:true};
  if(fn.name==='clickAddToPrompt'){clicks++;chips++;return true;}
 }};
 await P.confirmSelection(page,{expected:1});assert.equal(chips,1);assert.equal(clicks,1);
 await P.confirmSelection(page,{expected:1});assert.equal(clicks,1,'already attached reference must not be confirmed twice');
 await P.confirmSelection(page,{expected:2});assert.equal(clicks,2);
 console.log('PASS: multiword references preserved; selection confirmed through Add to prompt exactly once; immediate attachment supported.');
})().catch(e=>{console.error(e);process.exitCode=1;});
