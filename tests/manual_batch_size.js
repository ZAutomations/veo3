const assert=require('assert');const {groups}=require('../agent_manual_generation');
assert.deepStrictEqual(groups(13,{batch:2,size:3}),[{from:4,to:6},{from:7,to:9},{from:10,to:12},{from:13,to:13}]);
assert.deepStrictEqual(groups(13,{batch:1,size:20}),[{from:1,to:13}]);
assert.deepStrictEqual(groups(13,{batch:3}),[{from:11,to:13}]);
assert.deepStrictEqual(groups(13,{batch:1,size:1}).map(x=>x.from),Array.from({length:13},(_,i)=>i+1));
assert.deepStrictEqual(groups(13,{clips:'2,8,6',size:3}),[{from:2,to:2},{from:8,to:8},{from:6,to:6}]);
for(const size of [0,-1,2.5,'invalid',Infinity])assert.throws(()=>groups(13,{batch:1,size}),/positive whole/);
assert.throws(()=>groups(13,{batch:6,size:3}),/between 1 and 5/);
console.log('PASS: manual batch sizes 1/3/5/20, remainder, batch bounds, invalid sizes and explicit clip selection.');
