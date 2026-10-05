const fs = require('fs');
const { execFileSync } = require('child_process');

function hasVideoContainer(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 32) return false;
    // Reject HTML, JSON, images and login responses before touching the cache.
    return bytes.subarray(4, 8).toString('ascii') === 'ftyp'
        || bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
}

function playableVideo(file) {
    try {
        if (!hasVideoContainer(fs.readFileSync(file))) return { ok: false, why: 'Response is not a video container (possible sign-in page or image).' };
        const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
            'stream=codec_type,width,height:format=duration', '-of', 'json', file],
            { encoding: 'utf8', timeout: 30000, windowsHide: true }));
        if (!(Number(info.format?.duration) > 0)
            || !(info.streams || []).some(s => s.codec_type === 'video' && s.width > 0 && s.height > 0)) {
            return { ok: false, why: 'No usable video stream or duration.' };
        }
        // Parse metadata AND decode the entire clip, detecting truncated media.
        execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-map', '0:v:0', '-map', '0:a?',
            '-f', 'null', '-'], { timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, duration: Number(info.format.duration) };
    } catch (e) {
        return { ok: false, why: `Video validation failed: ${String(e.message).split('\n')[0].slice(0, 180)}` };
    }
}

module.exports = { hasVideoContainer, playableVideo };
