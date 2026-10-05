const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { normalizedJoinArgs } = require('./join_normalized');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-sync-'));
try {
    const files = [], probes = [];
    for (let i = 0; i < 4; i++) {
        const file = path.join(dir, `${i}.mp4`);
        const rate = i === 0 ? 48000 : 44100;
        execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=160x90:r=24:d=1`, '-f', 'lavfi', '-i', `sine=frequency=${400 + i * 200}:sample_rate=${rate}:duration=1`, '-c:v', 'libx264', '-c:a', 'aac', '-y', file]);
        files.push(file);
        probes.push({ width: 160, height: 90, fps: '24/1', videoDuration: 1, acodec: 'aac', audioStart: 0, videoStart: 0 });
    }
    const output = path.join(dir, 'joined.mp4');
    execFileSync('ffmpeg', ['-v', 'error', ...normalizedJoinArgs(files, probes, output)]);
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8' }));
    for (const stream of info.streams) assert(Math.abs(Number(stream.duration) - 4) < 0.025, `Wrong ${stream.codec_type} duration: ${stream.duration}`);
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1']);
    for (let i = 0; i < 4; i++) {
        let crossings = 0;
        const begin = Math.round((i + 0.2) * 8000), end = Math.round((i + 0.8) * 8000);
        for (let n = begin + 1; n < end; n++) if (pcm.readInt16LE((n - 1) * 2) <= 0 && pcm.readInt16LE(n * 2) > 0) crossings++;
        const frequency = crossings / 0.6;
        assert(Math.abs(frequency - (400 + i * 200)) < 5, `Audio moved to the wrong clip: ${i + 1}, ${frequency}Hz`);
    }
    console.log('PASS: mixed-rate audio remains aligned with all four video segments.');
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}
