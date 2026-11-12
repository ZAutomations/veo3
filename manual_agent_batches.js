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
const FULL_STORY_FILE = 'MANUAL_AGENT_FULL_STORY_ALL_BATCHES.txt';

function writeManualAgentBatches(storyPath, options = {}) {
    const absoluteStory = path.resolve(storyPath);
    const story = JSON.parse(fs.readFileSync(absoluteStory, 'utf8'));
    const scenes = Array.isArray(story.scenes) ? story.scenes : [];
    if (!scenes.length) throw new Error('Cannot export manual Agent batches: story has no scenes.');

    const storyDir = path.dirname(absoluteStory);
    const outputDir = path.join(storyDir, 'manual_agent_batches');
    fs.mkdirSync(outputDir, { recursive: true });
    const settingsFile=path.join(outputDir,'MANUAL_AGENT_SETTINGS.json');
    let saved={};try{saved=JSON.parse(fs.readFileSync(settingsFile,'utf8'));}catch{}
    const seconds = Number(options.seconds || story.scene_seconds || 8);
    const aspect = String(options.aspect || story.aspect_ratio || 'Flow');
    let globals={};
    try{globals=JSON.parse(fs.readFileSync(path.join(__dirname,'gui_settings.json'),'utf8')).workflow_globals||{};}catch{}
    let model=String(options.videoModel||globals.videoModel||'Omni 1.2 Flash');
    const resolution=String(options.videoResolution||process.env.VEO_MANUAL_RESOLUTION||saved.resolution||globals.videoResolution||'360p');
    if(!['360p','720p','1080p','Flow'].includes(resolution))throw Error('Choose manual batch resolution: 360p, 720p or 1080p.');
    if(seconds===10&&!/Omni.*Flash/i.test(model)){
        if(options.videoModel)throw Error('Manual 10-second batches require a compatible Omni Flash model; pass --video-model "Omni 1.2 Flash".');
        model='Omni 1.2 Flash'; // Export must not block story import because an unrelated 8s model is currently selected.
    }
    const safeTitle = String(story.title || path.basename(storyDir)).replace(/[\r\n]+/g, ' ').trim();
    const builder = path.join(__dirname, 'story_to_agent_prompt.js');
    const index = [
        `Story: ${safeTitle}`,
        `Clips: ${scenes.length}`,
        `Manual fallback files: ${Math.ceil(scenes.length / CLIPS_PER_FILE)}`,
        `Scenes per file: up to ${CLIPS_PER_FILE}`,
        `Clip duration: ${seconds} seconds`,
        `Aspect ratio: ${aspect}`,
        `Video model: ${model}`,
        `Native generation resolution: ${resolution}`,
        '',
        'Open the corresponding Flow project in a normal Chrome window, select Agent Mode,',
        'set the model, ratio and duration to match your production settings, then copy the',
        'complete prompt from each numbered file into Flow. Submit the files in order.',
        'Each prompt contains the shared preset/story instructions and only its listed scenes.',
        '',
    ];

    const fullStory = [
        `FULL STORY — ALL MANUAL FLOW AGENT BATCHES`,
        `Story: ${safeTitle}`,
        `Clips: ${scenes.length} | Clip duration: ${seconds}s | Aspect ratio: ${aspect}`,
        `Video model: ${model} | Native generation resolution: ${resolution}`,
        'All numbered batches follow in story order, with their complete Agent instructions.',
        'For six-clip submissions, copy one batch section at a time and wait for it to finish before the next.',
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
        const basePrompt = fs.readFileSync(temp, 'utf8').trim();
        fs.rmSync(temp, { force: true });
        if (!basePrompt) throw new Error(`Manual Agent batch ${from}-${to} was empty.`);
        const prompt=require('./agent_video_contract').withSettings(basePrompt,{model,resolution,seconds,aspect,manual:true});
        const header = [
            `MANUAL FLOW AGENT BATCH ${number}`,
            `Story: ${safeTitle}`,
            `Scenes: ${from}-${to} of ${scenes.length} (${to - from + 1} clips)`,
            `Clip duration: ${seconds}s | Aspect ratio: ${aspect}`,
            `Video model: ${model} | Native generation resolution: ${resolution}`,
            'Copy everything below this separator into Flow Agent Mode.',
            '============================================================',
            '',
        ].join('\n');
        const contents = header + prompt + '\n';
        fs.writeFileSync(file, contents, 'utf8');
        fullStory.push(contents);
        index.push(`${number}. Scenes ${from}-${to}: ${path.basename(file)}`);
        written++;
    }
    const fullStoryFile = path.join(outputDir, FULL_STORY_FILE);
    fs.writeFileSync(fullStoryFile, fullStory.join('\n'), 'utf8');
    index.push('', `Full story with every batch and complete instructions: ${FULL_STORY_FILE}`);
    fs.writeFileSync(path.join(outputDir, 'MANUAL_AGENT_BATCHES.txt'), index.join('\n') + '\n', 'utf8');
    fs.writeFileSync(settingsFile,JSON.stringify({model,resolution,seconds,aspect,exportedAt:new Date().toISOString()},null,2)+'\n');
    return { folder: outputDir, count: written, fullStoryFile };
}

if (require.main === module) {
    try {
        const storyPath = process.argv[2];
        if (!storyPath) throw new Error('Usage: node manual_agent_batches.js <story.json> [--aspect 9:16] [--seconds 8]');
        const val = name => {
            const i = process.argv.indexOf(name);
            return i >= 0 ? process.argv[i + 1] : undefined;
        };
        const result = writeManualAgentBatches(storyPath, { aspect: val('--aspect'), seconds: val('--seconds'),videoModel:val('--video-model'),videoResolution:val('--video-resolution') });
        console.log(`Wrote ${result.count} manual Agent batch file(s) in ${result.folder}`);
    } catch (error) {
        console.error(`Manual Agent batch export failed: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { writeManualAgentBatches, CLIPS_PER_FILE, FULL_STORY_FILE };
