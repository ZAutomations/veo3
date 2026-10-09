const assert=require('assert');
const {tileSnapshot,locateJob}=require('../single_clip_omni_media');
const original={window:global.window,document:global.document};
const rect=()=>({x:0,y:0,width:200,height:300});
const prompt='Sarah (female voice): "Because you paid my bride price? Because you provide for this family, I don\'t deserve to rest?"';
function fixture({spinner=false,queued=false,video=false}={}){
 const thumbnail={currentSrc:'https://flow-content.google/image/scene12-thumbnail',getAttribute:()=>''};
 const player={currentSrc:'blob:https://flow.google.com/completed-video',getAttribute:()=>''};
 const tile={textContent:'',parentElement:null,getBoundingClientRect:rect,
  querySelectorAll:s=>s==='video'?(video?[player]:[]):s==='video,source,img'?(video?[player]:[thumbnail]):[],
  querySelector:s=>s.includes('Generated video thumbnail')&&!video?thumbnail:null};
 const preview={parentElement:null,textContent:'',querySelectorAll:()=>[tile]};
 const row={parentElement:null,textContent:prompt+(queued?'\nQueued':''),innerText:prompt+(queued?'\nQueued':''),querySelectorAll:()=>[tile],
  querySelector:s=>s.includes('spinner')&&spinner?{}:null};
 const grid={parentElement:null,textContent:'Some other scene',querySelectorAll:()=>[tile,{}]};
 tile.parentElement=preview;preview.parentElement=row;row.parentElement=grid;
 global.window={};global.document={querySelectorAll:()=>[tile]};
 return tileSnapshot();
}
try{
 const tiles=fixture();assert.equal(tiles[0].text,prompt);assert(tiles[0].ready);
 assert.equal(locateJob(tiles,{number:12,prompt,scene:{dialogue:[{line:'Because you paid my bride price? Because you provide for this family, I don\'t deserve to rest?'}]}}).key,tiles[0].key);
 assert(!tiles[0].text.includes('Some other scene'));
 const player=fixture({video:true,spinner:true});assert(player[0].ready,'buffering after generation is not a queued generation');
 const queued=fixture({video:true,spinner:true,queued:true});assert(queued[0].busy&&!queued[0].ready,'explicit queue status must block completion');
 console.log('PASS: sibling prompt row identifies scene 12; neighbour excluded; completed thumbnail/blob player accepted; actual queued state still blocked.');
}finally{global.window=original.window;global.document=original.document;}
