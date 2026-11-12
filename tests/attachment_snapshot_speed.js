const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../agent_mode'),'utf8');
const read=source.slice(source.indexOf('async function readProjectSnapshot('),source.indexOf('// A failed clip surfaces twice.'));
const snap=source.slice(source.indexOf('    async function snap(label)'),source.indexOf('    // ---- 1. Agent Mode'));
let scans=0;
const context={EXPECTED_CLIPS:8,activityRetryPermit:false,MANUAL_ADD_COUNT:0,manualBaselineFailures:0,
 lastProjectScan:'',snapshotFn:()=>{},monitorProject:async()=>{scans++;return {ready_video_tile:8,flow_video_tile:8,generating_video_tile:0};},
 page:{evaluate:async()=>({mediaTiles:{agent_busy:false,flow_video_tile:8}})},log:()=>{},RUN_DIR:'tmp',snapN:0,
 fs:{writeFileSync:()=>{}},path:require('path')};
vm.createContext(context);
vm.runInContext(read+'\n'+snap,context);
(async()=>{
 for(const label of ['mention1-open','mention1-filtered','mention1-picked','mention2-open','mentions-final','prompt-final']){
  context.label=label;await vm.runInContext('snap(label)',context);
 }
 assert.equal(scans,0,'attachment diagnostics must not scroll/scan the project behind the picker');
 for(const label of ['baseline','final','safe-retry-final','batch-completed']){
  context.label=label;await vm.runInContext('snap(label)',context);
 }
 assert.equal(scans,4,'full inventory checks remain mandatory at generation/retry boundaries');
 console.log('PASS: reference/prompt diagnostics skip inventory scans; generation and retry boundaries retain them.');
})().catch(e=>{console.error(e);process.exitCode=1;});
