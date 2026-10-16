const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require('path').join(__dirname,'../desktop_ui/app.js'),'utf8');
const fn=source.slice(source.indexOf('function filterStoryQueue('),source.indexOf('function payload(){'));
function node(data={}){return {dataset:data,checked:true,classList:{hidden:false,selected:false,toggle(k,v){this[k]=v;}},querySelector(){return this.input;}};}
const rows=[node({done:'false'}),node({done:'true'})];rows.forEach(r=>r.input=node());
const buttons=['available','done','all'].map(queueFilter=>node({queueFilter}));
const ids={queueFilter:{value:''},'queue-empty':node(),'queue-count':{textContent:''}};
const context={$:id=>ids[id],document:{querySelectorAll(sel){return sel==='[data-queue-row]'?rows:sel==='[data-queue-filter]'?buttons:rows.map(r=>r.input).filter(n=>n.checked);}}};
vm.createContext(context);vm.runInContext(fn,context);
context.filterStoryQueue('available');assert(!rows[0].classList.hidden);assert(rows[1].classList.hidden);assert(!rows[1].input.checked);assert.equal(ids['queue-count'].textContent,'1 stories selected');
context.filterStoryQueue('done');assert(rows[0].classList.hidden);assert(!rows[1].classList.hidden);assert(!rows[0].input.checked);assert(buttons[1].classList.selected);
context.filterStoryQueue('all');assert(rows.every(r=>!r.classList.hidden));assert(buttons[2].classList.selected);
context.filterStoryQueue('bad');assert.equal(ids.queueFilter.value,'available');
console.log('PASS: three filters show the correct rows and deselect hidden stories before batch generation.');
