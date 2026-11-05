#!/usr/bin/env node
/**
 * Export copy/paste-ready Agent Mode prompts for manual browser fallback.
 * Each file mirrors story_to_agent_prompt.js for a contiguous six-scene range.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CLIPS_PER_FILE = 6;

function writeManualAgentBatches(storyPath, options = {}) {
    const absoluteStory = path.resolve(storyPath);
    const story = JSON.parse(fs.readFileSync(absoluteStory, 'utf8'));
    const scenes = Array.isArray(story.scenes) ? story.scenes : [];
    if (!scenes.length) throw new Error('Cannot export manual Agent batches: story has no scenes.');

    const storyDir = path.dirname(absoluteStory);
    const outputDir = path.join(storyDir, 'manual_agent_batches');
    fs.mkdirSync(outputDir, { recursive: true });
    const seconds = Number(options.seconds || story.scene_seconds || 8);
    const aspect = String(options.aspect || story.aspect_ratio || 'Flow');
    const safeTitle = String(story.title || path.basename(storyDir)).replace(/[\r\n]+/g, ' ').trim();
    const builder = path.join(__dirname, 'story_to_agent_prompt.js');
    const index = [
        `Story: ${safeTitle}`,
        `Clips: ${scenes.length}`,
        `Manual fallback files: ${Math.ceil(scenes.length / CLIPS_PER_FILE)}`,
        `Scenes per file: up to ${CLIPS_PER_FILE}`,
        `Clip duration: ${seconds} seconds`,
        `Aspect ratio: ${aspect}`,
        '',
        'Open the corresponding Flow project in a normal Chrome window, select Agent Mode,',
        'set the model, ratio and duration to match your production settings, then copy the',
        'complete prompt from each numbered file into Flow. Submit the files in order.',
        'Each prompt contains the shared preset/story instructions and only its listed scenes.',
        '',
    ];

    let written = 0;
    for (let from = 1; from <= scenes.length; from += CLIPS_PER_FILE) {
        const to = Math.min(scenes.length, from + CLIPS_PER_FILE - 1);
        const number = String(written + 1).padStart(3, '0');
        const file = path.join(outputDir,
            `MANUAL_AGENT_BATCH_${number}_SCENES_${String(from).padStart(3, '0')}_${String(to).padStart(3, '0')}.txt`);
        const temp = file + '.prompt.tmp';
        const args = [builder, absoluteStory, '--scene-from', String(from), '--scene-to', String(to),
            '--aspect', aspect, '--seconds', String(seconds), '--out', temp];
        if (options.flowCharacters) args.push('--flow-characters');
        const result = spawnSync(process.execPath, args, { cwd: __dirname, encoding: 'utf8', timeout: 120000 });
        if (result.error || result.status !== 0) {
            try { fs.rmSync(temp, { force: true }); } catch {}
            throw new Error(`Could not build manual Agent batch ${from}-${to}: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
        }
        const prompt = fs.readFileSync(temp, 'utf8').trim();
        fs.rmSync(temp, { force: true });
        if (!prompt) throw new Error(`Manual Agent batch ${from}-${to} was empty.`);
        const header = [
            `MANUAL FLOW AGENT BATCH ${number}`,
            `Story: ${safeTitle}`,
            `Scenes: ${from}-${to} of ${scenes.length} (${to - from + 1} clips)`,
            `Clip duration: ${seconds}s | Aspect ratio: ${aspect}`,
            'Copy everything below this separator into Flow Agent Mode.',
            '============================================================',
            '',
        ].join('\n');
        fs.writeFileSync(file, header + prompt + '\n', 'utf8');
        index.push(`${number}. Scenes ${from}-${to}: ${path.basename(file)}`);
        written++;
    }
    fs.writeFileSync(path.join(outputDir, 'MANUAL_AGENT_BATCHES.txt'), index.join('\n') + '\n', 'utf8');
    return { folder: outputDir, count: written };
}

if (require.main === module) {
    try {
        const storyPath = process.argv[2];
        if (!storyPath) throw new Error('Usage: node manual_agent_batches.js <story.json> [--aspect 9:16] [--seconds 8]');
        const val = name => {
            const i = process.argv.indexOf(name);
            return i >= 0 ? process.argv[i + 1] : undefined;
        };
        const result = writeManualAgentBatches(storyPath, { aspect: val('--aspect'), seconds: val('--seconds') });
        console.log(`Wrote ${result.count} manual Agent batch file(s) in ${result.folder}`);
    } catch (error) {
        console.error(`Manual Agent batch export failed: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { writeManualAgentBatches, CLIPS_PER_FILE };
