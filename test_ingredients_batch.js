const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planBatch, runBatch } = require('./ingredients_batch');

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingredients-batch-'));
    try {
        const stories = [1, 2, 3].map(n => {
            const file = path.join(dir, `${n}_story.json`);
            fs.writeFileSync(file, JSON.stringify({ scenes: [{}] }));
            return file;
        });
        const input = { stories, from: 2, to: 0, options: {
            video_model: 'Veo 3.1 - Fast', aspect: '9:16', download: false, cdp: 9333,
        } };
        const jobs = planBatch(input);
        assert.deepEqual(jobs.map(j => j.index), [2, 3]);
        for (const job of jobs) {
            for (const flag of ['--new-project', '--gen-refs', '--refs-on-clip1', '--auto-start', '--no-download']) {
                assert(job.args.includes(flag), flag);
            }
            assert.equal(job.args[job.args.indexOf('--aspect') + 1], '9:16');
            assert.equal(job.args[job.args.indexOf('--video-model') + 1], 'Veo 3.1 - Fast');
            assert.equal(job.args[job.args.indexOf('--cdp') + 1], '9333');
            assert.equal(job.args[job.args.indexOf('--from') + 1], '1');
        }
        const refs = planBatch({ stories, options: { refs_only: true, join: true } });
        assert(refs.every(j => j.args.includes('--refs-only') && !j.args.includes('--auto-start') && !j.args.includes('--join')));
        const join = planBatch({ stories, options: { join: true, download: false } });
        assert(join.every(j => j.args.includes('--join') && !j.args.includes('--no-download')));
        let active = false;
        const order = [];
        const completed = await runBatch({ stories }, { log() {}, run: async job => {
            assert.equal(active, false, 'jobs must not overlap');
            active = true; order.push(job.index);
            await new Promise(resolve => setTimeout(resolve, 5));
            active = false; return 0;
        } });
        assert.deepEqual(order, [1, 2, 3]);
        assert.equal(completed.state.status, 'complete');
        for (const failure of [2, 3, 'throw']) {
            const ran = [];
            let persisted;
            const result = await runBatch({ stories }, { log() {}, save: s => { persisted = structuredClone(s); },
                run: async (job, onProject) => {
                    ran.push(job.index); onProject(`https://flow.google.com/project/test-${job.index}`);
                    if (job.index === 1) return 0;
                    if (failure === 'throw') throw Error('fixture failure');
                    return failure;
                },
            });
            assert.deepEqual(ran, [1, 2]);
            assert.equal(result.code, failure === 'throw' ? 1 : failure);
            assert.equal(persisted.resume_from, 2);
            assert.equal(persisted.jobs[0].status, 'complete');
            assert.equal(persisted.jobs[1].status, 'failed');
            assert.equal(persisted.jobs[1].project_url, 'https://flow.google.com/project/test-2');
        }
        const invalid = path.join(dir, 'bad.json');
        fs.writeFileSync(invalid, '{"scenes":[]}');
        let ran = false;
        await assert.rejects(runBatch({ stories: [stories[0], invalid] }, { run: async () => { ran = true; } }), /No scenes/);
        assert.equal(ran, false);
        assert.throws(() => planBatch({ stories, from: 4 }), /Invalid story range/);
        console.log('Ingredients batch passed: sequential execution, range, settings, refs-only, joins, failure/credits stops, progress, upfront validation.');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
