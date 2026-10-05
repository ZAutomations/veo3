const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runAgentBatches } = require('./agent_batches');

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo3-agent-batches-'));
    try {
        const story = path.join(dir, 'test_story.json');
        fs.writeFileSync(story, JSON.stringify({ title: 'Test', aspect_ratio: '16:9', scenes: Array.from({length: 14}, (_, i) => ({
            _scene_number: i + 1, script_line: `Words for scene ${i + 1}`, narrative_context: 'A room.', characters: [],
        })) }));
        const args = { project_url: 'https://flow.google.com/project/test', submit: true, aspect: '9:16', clip_batch_size:6 };
        const calls = [];
        let fail = true;
        const run = async (scriptOrArgs, argv) => {
            if (typeof scriptOrArgs === 'string') {
                const out = execFileSync(process.execPath, [path.join(__dirname, scriptOrArgs), ...argv], {encoding:'utf8'});
                return {code:0, out, err:''};
            }
            calls.push(scriptOrArgs);
            if (!scriptOrArgs._retry_only) {
                const intent = JSON.parse(fs.readFileSync(scriptOrArgs._submission_file));
                intent.status = 'submitting';
                fs.writeFileSync(scriptOrArgs._submission_file, JSON.stringify(intent));
            }
            assert.equal(scriptOrArgs.aspect, '9:16', 'GUI ratio reaches Flow settings on every batch');
            const batchPrompt = fs.readFileSync(scriptOrArgs._prompt_file, 'utf8');
            assert.match(batchPrompt, /FORMAT: every clip is 9:16 portrait \(vertical\)/);
            assert.match(batchPrompt, /Their dimensions must not override the video format/);
            assert.doesNotMatch(batchPrompt, /FORMAT: keep the aspect ratio|FORMAT: every clip is 16:9/);
            return {ok: !(fail && scriptOrArgs._expected === 12), text:'mock generation result'};
        };
        const first = await runAgentBatches(args, story, run, () => {});
        assert.equal(first.ok, false);
        assert.deepEqual(calls.map(c => c._expected), [6,12]);
        const checkpoint = JSON.parse(fs.readFileSync(path.join(dir,'agent_batches_test.json')));
        assert.equal(checkpoint.completed, 6);
        assert.deepEqual(checkpoint.pending, {from:7,to:12});
        const prompt = fs.readFileSync(path.join(dir,'agent_batch_7_12.txt'),'utf8');
        assert.match(prompt, /Create 6 separate clips/);
        assert.match(prompt, /Scene 7\n/);
        assert.match(prompt, /Scene 12\n/);
        assert.doesNotMatch(prompt, /Scene 6\n|Scene 13\n/);
        fail = false;
        calls.length = 0;
        assert.equal((await runAgentBatches(args,story,run,()=>{})).ok,true);
        assert.deepEqual(calls.map(c=>c._expected), [12,14]);
        assert.equal(calls[0]._retry_only,true);
        assert.equal(calls[1]._retry_only,false);
        assert.equal(calls[1]._required_ready,12);
        calls.length = 0;
        assert.equal((await runAgentBatches(args,story,run,()=>{})).ok,true);
        assert.equal(calls.length,0);
        // A prompt preparation failure must retry normally; no credit click happened.
        checkpoint.completed = 0;
        checkpoint.pending = {from:1,to:6};
        fs.writeFileSync(path.join(dir,'agent_batches_test.json'), JSON.stringify(checkpoint));
        fs.writeFileSync(path.join(dir,'agent_batches_test.json.submission.json'), JSON.stringify({
            fingerprint: checkpoint.fingerprint, from:1, to:6, status:'preparing'
        }));
        calls.length = 0;
        assert.equal((await runAgentBatches(args,story,run,()=>{})).ok,true);
        assert.equal(calls[0]._retry_only,false);

        // Old uncertain checkpoints require inspection, then may resend only
        // when the driver positively identifies a failed request with no media.
        fs.writeFileSync(path.join(dir,'agent_batches_test.json'), JSON.stringify(checkpoint));
        fs.unlinkSync(path.join(dir,'agent_batches_test.json.submission.json'));
        calls.length = 0;
        const rejectRequest = async (arg, argv) => {
            if (typeof arg !== 'string' && arg._retry_only) {
                calls.push(arg);
                return {ok:false, retrySubmission:true, text:'verified pre-media Agent error'};
            }
            return run(arg,argv);
        };
        assert.equal((await runAgentBatches(args,story,rejectRequest,()=>{})).ok,true);
        assert.deepEqual(calls.map(c=>[c._expected,c._retry_only]), [[6,true],[6,false],[12,false],[14,false]]);
        calls.length = 0;
        const fiveCalls=[];
        const fiveRun=async(arg,argv)=>{
            if(typeof arg==='string')return run(arg,argv);
            fiveCalls.push(arg._expected);return {ok:true,text:'completed'};
        };
        assert((await runAgentBatches({...args,project_url:'https://flow.google.com/project/five',clip_batch_size:undefined},story,fiveRun,()=>{})).ok);
        assert.deepEqual(fiveCalls,[5,10,14],'default batch size five reaches every scene');
        const incomplete=path.join(dir,'incomplete.json');
        fs.writeFileSync(incomplete,JSON.stringify({total_scenes:14,scenes:[{},{}]}));
        assert(!(await runAgentBatches(args,incomplete,fiveRun,()=>{})).ok);
        fs.appendFileSync(story,' ');
        assert.equal((await runAgentBatches(args,story,run,()=>{})).ok,false);
        assert.equal(calls.length,0);
        console.log('Agent batches passed: 6/6/2 scenes, stop on partial batch, persistent recovery without replay, completed reuse, changed-script guard.');
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
