const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {EventEmitter} = require('events');
const root = path.resolve(__dirname, '..');
const {selectedClips, groups} = require('../agent_manual_generation');
const {resolveSceneManifest, downloadCompletion} = require('../download_tile_logic');
const {wheelGrid} = require('../flow_grid_scroll');

(async () => {
    assert.deepStrictEqual(selectedClips('2,8,6', 20), [2,8,6]);
    assert.deepStrictEqual(groups(20, {batch:4}), [{from:16,to:20}]);
    assert.throws(() => selectedClips('21',20));
    const ordered = resolveSceneManifest({expected:2,complete:false,clips:[
        {file:'scene-01.mp4',matched_scene:2,match_cover:1,got:true},
        {file:'scene-02.mp4',matched_scene:1,match_cover:1,got:true}]});
    assert.deepStrictEqual(ordered.clips.map(c=>c.file), ['scene-02.mp4','scene-01.mp4']);
    assert.equal(ordered.complete,true);
    assert.equal(downloadCompletion([{file:'one.mp4',got:true}],2,false,0).downloadComplete,false);
    const actions=[];
    await wheelGrid({evaluate:async()=>({x:300,y:400}),mouse:{move:async(x,y)=>actions.push(['move',x,y]),wheel:async(o)=>actions.push(['wheel',o.deltaY])}},500);
    assert.deepStrictEqual(actions,[['move',300,400],['wheel',500]]);

    // Run the actual manual runner with a simulated child process. No browser,
    // generated clips, API calls or real files are involved.
    const calls=[];const moduleStub={exports:{}};
    const fakeRequire=id=>id==='fs'?{
        readFileSync:()=>JSON.stringify({scenes:Array(20).fill({}),aspect_ratio:'9:16'}),mkdirSync:()=>{},writeFileSync:()=>{}
    }:id==='child_process'?{spawn:(exe,args)=>{
        calls.push(args);const emitter=new EventEmitter();process.nextTick(()=>emitter.emit('close',0));return emitter;
    }}:require(id);
    fakeRequire.main=moduleStub;
    const context={require:fakeRequire,module:moduleStub,__dirname:root,Date,
        console:{log:()=>{},error:message=>{throw Error(message)}},
        process:{execPath:process.execPath,argv:['node','runner','--story','test.json','--project-url',
            'https://flow.google.com/project/test-project','--batch','4','--video-model','Veo 3.1 - Lite','--aspect','9:16']}};
    vm.runInNewContext(fs.readFileSync(path.join(root,'agent_manual_generation.js'),'utf8'),context);
    await new Promise(resolve=>setTimeout(resolve,30));
    const generation=calls.find(args=>args[0].endsWith('agent_mode.js'));
    assert(generation);assert(!generation.includes('--settings'));
    assert.equal(generation[generation.indexOf('--manual-add-count')+1],'5');
    assert.equal(generation[generation.indexOf('--video-model')+1],'Veo 3.1 - Lite');
    assert.equal(generation[generation.indexOf('--aspect')+1],'9:16');
    console.log('PASS: story mapping, incomplete download gate, wheel scrolling and selected generation settings.');
})().catch(error=>{console.error(error);process.exitCode=1});
