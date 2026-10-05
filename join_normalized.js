// Decode each input separately, normalize its clock/format, then concatenate.
// The concat demuxer must never interpret mixed audio sample rates as one stream.
function normalizedJoinArgs(paths, probes, output, options = {}) {
    const first = probes[0];
    if (!first?.width || !first.height) throw new Error('Cannot probe the first clip video.');
    const fps = first.fps || '24';
    const graph = [], inputs = [];
    const args = ['-y', '-filter_complex_threads', '2'];
    for (let i = 0; i < paths.length; i++) {
        const p = probes[i];
        const duration = p?.videoDuration || p?.duration;
        if (!(duration > 0)) throw new Error(`Cannot determine video duration for clip ${i + 1}.`);
        args.push('-threads', '2', '-i', paths[i]);
        graph.push(`[${i}:v:0]setpts=PTS-STARTPTS,scale=${first.width}:${first.height}:force_original_aspect_ratio=decrease,pad=${first.width}:${first.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},trim=duration=${duration},setpts=PTS-STARTPTS[v${i}]`);
        if (p.acodec) {
            const offset = (p.audioStart || 0) - (p.videoStart || 0);
            const timing = offset > 0 ? `,adelay=${Math.round(offset * 1000)}:all=1`
                : offset < 0 ? `,atrim=start=${-offset},asetpts=PTS-STARTPTS` : '';
            const loudness = options.audioFilters?.[i] ? `,${options.audioFilters[i]},aresample=48000` : '';
            graph.push(`[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS${timing}${loudness},apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${i}]`);
        } else {
            graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${i}]`);
        }
        inputs.push(`[v${i}][a${i}]`);
    }
    graph.push(`${inputs.join('')}concat=n=${paths.length}:v=1:a=1[vout][aout]`);
    args.push('-filter_complex', graph.join(';'), '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-threads', '2', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k', '-movflags', '+faststart', output);
    return args;
}

module.exports = { normalizedJoinArgs };
