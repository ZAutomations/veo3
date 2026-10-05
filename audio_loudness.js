function measureLoudness(file) {
    let stderr;
    // ffmpeg emits measurements on stderr, including on successful execution.
    const { spawnSync } = require('child_process');
    const result = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-vn',
        '-af', 'aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
        '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    if (result.error || result.status !== 0) throw Error(`Audio measurement failed for ${file}: ${result.error?.message || result.stderr?.slice(-600)}`);
    stderr = result.stderr;
    const blocks = stderr.match(/\{\s*"input_i"[\s\S]*?\}/g);
    if (!blocks?.length) throw Error(`No loudness measurement returned for ${file}`);
    return JSON.parse(blocks[blocks.length - 1]);
}
function loudnessFilter(m) {
    if (!['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].every(k => Number.isFinite(Number(m[k])))) return '';
    return `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
}
module.exports = { measureLoudness, loudnessFilter };
