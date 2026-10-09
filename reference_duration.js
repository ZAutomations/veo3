const { promisify } = require('util');
const exec = promisify(require('child_process').execFile);
const memo = new Map();
async function probeDuration(url) {
    if (!require('./gemini_video_source').isYouTube(url)) return null;
    if (memo.has(url)) return memo.get(url);
    const command = require('./gemini_video_source').ytDlpPath();
    if (!command) return null;
    try {
        const { stdout } = await exec(command, ['--skip-download', '--no-playlist', '--no-warnings',
            '--socket-timeout', '12', '--retries', '1', '--js-runtimes', `node:${process.execPath}`,
            '--print', 'duration', url], { timeout: 45000, windowsHide: true, maxBuffer: 1024 * 1024 });
        const seconds = Number(stdout.trim().split(/\r?\n/).at(-1));
        if (!(seconds > 0)) return null;
        const result = { duration_s: seconds, verified_by: 'yt-dlp video metadata', url };
        memo.set(url, result); return result;
    } catch { return null; }
}
function verifiedSeconds(cm) { const n = Number(cm?.source_metadata?.duration_s); return n > 0 ? n : 0; }
function timingMismatch(cm, seconds, clipSeconds = 8) {
    const declared = Number(cm?.format?.source_duration_s || cm?.source_duration_s) || 0;
    const tolerance = Math.max(2, Number(clipSeconds) || 8);
    if (declared && Math.abs(declared - seconds) > tolerance) return true;
    const time = value => { const m = String(value || '').match(/^(\d+):(\d+(?:\.\d+)?)$/); return m ? Number(m[1])*60+Number(m[2]) : 0; };
    return [...(cm?.clips || cm?.segments || []), ...(cm?.facts || [])].some(c =>
        Math.max(time(c.t_start), time(c.t_end), time(c.t)) > seconds + tolerance);
}
function sourceUnavailable(cm) {
    return /(?:source|video|link)[^.\n]*(?:unavailable|could not be accessed|cannot be accessed|unable to access)|(?:unable|cannot|could not) (?:to )?(?:access|watch|view) (?:the |this )?(?:source|video)/i.test(String(cm?.notes || ''));
}
module.exports = { probeDuration, verifiedSeconds, timingMismatch, sourceUnavailable };
