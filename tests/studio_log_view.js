const assert=require('assert');
const {create}=require('../desktop_ui/log_view');
let resets=0,appends=0,selection={isCollapsed:true};
const element={children:[],scrollHeight:100,scrollTop:0,clientHeight:100,
 contains:n=>element.children.includes(n),
 set textContent(value){resets++;this.children=value?[{text:value}]:[];},
 appendChild(node){appends++;this.children.push(node);this.scrollHeight+=10;}};
const doc={getSelection:()=>selection,createTextNode:text=>({text})};
const view=create(element,doc);
view.append(['First log']);assert.equal(appends,1);
const anchor=element.children[0];selection={isCollapsed:false,anchorNode:anchor};
const count=resets;view.append([]);assert.equal(resets,count);assert.equal(appends,1);
element.scrollTop=0;view.append(['Second log']);assert.equal(element.children[0],anchor);assert.equal(element.scrollTop,0);
view.pause(true);view.append(['Third log']);assert.equal(appends,2);
view.pause(false);assert.equal(appends,3);assert.equal(element.children[0],anchor);
assert(element.children.map(n=>n.text).join('').includes('Third log'));
console.log('PASS: idle polls do not redraw logs; append preserves selected text nodes and scroll; paused output resumes without dropping lines.');
