const assert=require('assert'),R=require('../reference_project_recovery'),RI=require('../reference_image_step'),grid=require('../flow_grid_scroll');
(async()=>{const refs=[{name:'SAM',kind:'character',prompt:'Original man. Black turtleneck and charcoal blazer.'},{name:'Sarah',kind:'character',prompt:'Original woman. Navy trench coat and auburn ponytail.'},{name:'Venue',kind:'place',prompt:'Empty parked car on a rooftop. No people.'}];
const images=[{key:'car',name:'Parked car in rooftop parking',tileIndex:0},{key:'woman',name:'Woman in navy trench coat',tileIndex:1},{key:'man',name:'Man wearing black turtleneck',tileIndex:2}];
const pending={status:'pending',before:{images:[]}};assert(R.chooseImage(images,refs,0,pending).ambiguous);
const originalPrompts={car:refs[2].prompt,woman:refs[1].prompt,man:refs[0].prompt};let reads=0,renames=[];
const page={evaluate:async(fn,arg)=>{if(fn===RI.referenceState)return {images:images.map(x=>({...x})),videos:[],errors:[]};if(fn===grid.gridMetrics)return {top:0,client:100,scroll:100};}};
const readName=async(_,i)=>images.find(x=>x.tileIndex===i).name;
const rename=async(_,name,i)=>{const im=images.find(x=>x.tileIndex===i);renames.push([im.key,name]);im.name=name;return {ok:true}};
const opts={sleep:async()=>{},readPrompt:async(_,im)=>{reads++;return originalPrompts[im.key].replace(/ /g,'  ')+'\n\n'}};
for(let i=0;i<3;i++){let saved=pending;const receipt={read:()=>saved,write:r=>{saved=r}};const result=await R.auditExisting(page,refs,i,receipt,readName,rename,()=>{},opts);assert(result.ok);assert.equal(saved.status,'completed');}
assert.deepEqual(renames,[['man','SAM'],['woman','Sarah'],['car','Venue']]);assert.equal(reads,3,'source inspection cached within preparation run');
const unknown=[{key:'a',name:'Man in a coat',prompt:'Different original man.'},{key:'b',name:'Man in a coat',prompt:'Another unrelated man.'}];assert(R.chooseImage(unknown,refs,0,pending).ambiguous);
assert(R.chooseImage([{key:'x',name:'image',prompt:refs[0].prompt}],refs.concat({...refs[0],name:'Other'}),0,pending).ambiguous,'same source prompt for different roles must not become an identity guess');
console.log('PASS: exact source prompts recover all three generically named manual references in any grid order, normalize whitespace, rename once and cache reads; unrelated/shared prompts remain blocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
