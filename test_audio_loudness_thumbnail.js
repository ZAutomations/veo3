const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { measureLoudness } = require('./audio_loudness');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-loudness-'));
try {
    const clips = path.join(dir, 'clips');
    fs.mkdirSync(clips);
    const story = { title: 'The Quietest Goodbye', description: 'George asks for divorce; Sarah accepts calmly.',
        narration_scope: 'dialogue', style: 'Hand-painted animation', character_descriptions: { sarah: 'girl', george: 'man' },
        thumbnail: { headline: 'Why So Calm?', visual_concept: 'Sarah composed on the left, George surprised on the right, at their bedroom doorway.' } };
    fs.writeFileSync(path.join(dir, 'film_story.json'), JSON.stringify(story));
    for (let i = 0; i < 2; i++) {
        execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=24:d=3',
            '-f', 'lavfi', '-i', `sine=frequency=${500 + i * 300}:sample_rate=${i ? 44100 : 48000}:duration=3`,
            '-af', `volume=${i ? 1 : .1}`, '-c:v', 'libx264', '-c:a', 'aac', '-y', path.join(clips, `scene-0${i + 1}.mp4`)]);
    }
    const output = path.join(dir, 'joined.mp4');
    const log = execFileSync(process.execPath, ['join_clips.js', clips, '--out', output], { encoding: 'utf8' });
    assert(log.includes('balanced per clip'), 'Dialogue default did not enable loudness normalization');
    const levels = [];
    for (let i = 0; i < 2; i++) {
        const segment = path.join(dir, `segment-${i}.wav`);
        execFileSync('ffmpeg', ['-v', 'error', '-ss', String(i * 3), '-i', output, '-t', '3', '-y', segment]);
        levels.push(Number(measureLoudness(segment).input_i));
    }
    assert(Math.abs(levels[0] - levels[1]) < 1, `Volume jump remains: ${levels}`);
    assert(levels.every(n => Math.abs(n + 16) < 1), `Target not reached: ${levels}`);
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8' }));
    for (const stream of info.streams) assert(Math.abs(Number(stream.duration) - 6) < .03);
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1']);
    for (let i = 0; i < 2; i++) {
        let crossings = 0;
        for (let n = (i * 3 + 1) * 8000; n < (i * 3 + 2) * 8000; n++) if (pcm.readInt16LE((n - 1) * 2) <= 0 && pcm.readInt16LE(n * 2) > 0) crossings++;
        assert(Math.abs(crossings - (500 + i * 300)) < 5, 'Audio moved to the wrong video segment');
    }
    const { writeThumbnailPrompts } = require('./thumbnail_prompt');
    writeThumbnailPrompts(dir, story);
    for (const [file, ratio] of [['thumbnail_prompt.txt', '16:9'], ['thumbnail_prompt_vertical.txt', '9:16']]) {
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        assert(text.includes(ratio) && text.includes(story.thumbnail.visual_concept) && text.includes(story.style));
        assert(text.includes('sarah, george') && text.includes('Why So Calm?'));
    }
    console.log(`PASS: quiet first clip and louder continuation balanced (${levels.join(', ')} LUFS); duration and segment sync preserved; both thumbnail prompts saved.`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
