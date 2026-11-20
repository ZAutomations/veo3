const assert=require('assert'),{inspectIdle}=require('../agent_missing_scenes');

async function checkAgentAudit() {
    const fs = require('fs');
    const vm = require('vm');
    const driver = fs.readFileSync(require.resolve('../agent_mode'), 'utf8');
    const source = driver.match(/(?:async )?function inspectAgentRecoverySources\([\s\S]*?\n}/)[0];
    const page = {};
    const frames = [
        {generating_video_tile: 1, flow_video_tile: 1, project_scan_complete: true},
        {agent_busy: true, flow_video_tile: 0},
        {flow_video_tile: 0, project_scan_complete: true},
    ];
    let audits = 0;
    const inspect = vm.runInNewContext('(' + source + ')', {
        log: () => {},
        readProjectSnapshot: async (target, full) => {
            assert.strictEqual(target, page);
            assert.strictEqual(full, true);
            return {mediaTiles: frames.shift()};
        },
        require: () => ({
            inspectProject: async (_engine, _jobs, _receipts, options) => {
                audits++;
                assert.strictEqual(frames.length, 0);
                assert.strictEqual(options.allowImageOnlyGrid, true);
                return {exhaustive: true, tiles: []};
            },
        }),
    });
    const cache = new Map();
    const result = await inspectIdle((engine, jobs) => inspect(engine, jobs, cache),
        {page}, [], async () => {});
    assert.strictEqual(audits, 1);
    assert.strictEqual(result.exhaustive, true);
}

checkAgentAudit().catch(error => { console.error(error); process.exitCode = 1; });
(async()=>{let calls=0,waits=0;const result=await inspectIdle(async()=>++calls<3?{generatingSeen:1,tiles:[{busy:true}]}:{generatingSeen:0,tiles:[{ready:true}]},{},[],async()=>waits++);assert.equal(calls,3);assert.equal(waits,2);assert(result.tiles[0].ready);await assert.rejects(inspectIdle(async()=>({generatingSeen:1}),{},[],async()=>{},()=>{},1),/Nothing resubmitted/);console.log('PASS: active clips awaited, ready result audited, bounded wait never authorizes duplicate submission');})().catch(e=>{console.error(e);process.exitCode=1});
