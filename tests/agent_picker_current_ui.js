const assert=require('assert'),fs=require('fs'),vm=require('vm');
const {categoryStateSelected}=require('../reference_picker_images');
const MT=require('../mention_target');
const rect=()=>({width:100,height:30});
const active={className:'side-nav-list-item-active',hasAttribute:()=>false,parentElement:null};
let parent=active;
for(let i=0;i<5;i++)parent={className:'mdc-wrapper',hasAttribute:()=>false,parentElement:parent};
const label={textContent:'Images',getBoundingClientRect:rect,className:'',hasAttribute:()=>false,parentElement:parent};
const before=global.document;
global.document={querySelectorAll:()=>[label]};
assert(categoryStateSelected('Images'),'selection on a deeply wrapped Angular list item must be detected');
global.document=before;
assert.deepEqual(MT.distinctMentions(['Sunroom.','Sarah','Sunroom','George']),['Sunroom','Sarah','George']);
const candidates=[{tag:'button',text:'George.jpg',kind:'image',depth:10,rect:{x:0,y:0,w:100,h:40}},
 {tag:'span',text:'George.jpg',kind:'image',depth:12,rect:{x:3,y:3,w:80,h:20}},
 {tag:'button',text:'George',kind:'video',depth:14,rect:{x:100,y:0,w:100,h:40}}];
const chosen=MT.chooseMentionTile(candidates,'George',{requiredKind:'image'});
assert.equal(chosen.kind,'image');assert.equal(chosen.inner.tag,'span');
assert.equal(MT.chooseMentionTile(candidates.filter(c=>c.kind==='video'),'George',{requiredKind:'image'}).inner,null);
const driver=fs.readFileSync('agent_mode.js','utf8');
assert(driver.includes('promptTextLength:'));assert(driver.includes('s.promptTextLength ?? got.length'));
console.log('PASS: deeply wrapped Images state, image-only typed rows, video rejection, punctuation normalization and full prompt length.');
