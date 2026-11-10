"""Optional preset-local CTA inserted after edited story and before thumbnail."""
from pathlib import Path
import json
import re


def find(source, root):
    stories=list(Path(source).parent.glob('*_story.json'))
    if len(stories)!=1:return None
    story=json.loads(stories[0].read_text(encoding='utf-8-sig'))
    preset=story.get('preset_id','')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*',preset):return None
    library=(Path(root)/'Preset References').resolve()
    folder=(library/preset).resolve()
    if not folder.is_relative_to(library):raise ValueError('Preset CTA folder is outside the reference library.')
    matches=[folder/(preset+'CTA'+ext) for ext in ('.mp4','.mov','.mkv','.webm') if (folder/(preset+'CTA'+ext)).is_file()]
    if len(matches)>1:raise ValueError('Multiple preset CTA videos found. Keep one file named '+preset+'CTA with a supported video extension.')
    if not matches:return None
    clip=matches[0].resolve()
    if not clip.is_relative_to(folder):raise ValueError('Preset CTA file is outside its preset folder.')
    # Re-editing an already finished export must not append the CTA twice.
    receipt=Path(source).parent/'video_editing'/'last_edit.json'
    if receipt.is_file():
        saved=json.loads(receipt.read_text(encoding='utf-8-sig'))
        if saved.get('preset_cta') and Path(saved.get('output','')).resolve()==Path(source).resolve():
            raise ValueError('This video already contains a preset CTA. Select the original raw video to render again without duplicating it.')
    return clip


def signature(clip):
    return [str(clip),clip.stat().st_size,clip.stat().st_mtime_ns] if clip else None


def append(source, clip, output, work, thumbnail_seconds=0):
    import video_editing as E
    info=E.probe(source);cta=E.probe(clip)
    if not cta.get('width') or cta['duration']<=0:raise ValueError('Preset CTA must be a playable video.')
    # CTA is added after editing, captions and speed: its original speech/music is retained.
    cut=max(0.,info['duration']-float(thumbnail_seconds))
    if cut<=0:raise ValueError('Cannot locate story before thumbnail for CTA insertion.')
    segments=[(0,0.,cut),(1,0.,cta['duration'])]
    if thumbnail_seconds>0:segments.append((0,cut,info['duration']))
    graph=[];links=[]
    for n,(index,start,end) in enumerate(segments):
        duration=end-start
        graph.append(f'[{index}:v:0]trim=start={start}:end={end},setpts=PTS-STARTPTS,scale={info["width"]}:{info["height"]}:force_original_aspect_ratio=decrease,pad={info["width"]}:{info["height"]}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={info["fps"]},tpad=stop_mode=clone:stop_duration={duration},trim=duration={duration},format=yuv420p[v{n}]')
        has_audio=info['audio'] if index==0 else cta['audio']
        if has_audio:
            graph.append(f'[{index}:a:0]atrim=start={start}:end={end},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration={duration}[a{n}]')
        else:graph.append(f'anullsrc=r=48000:cl=stereo,atrim=duration={duration}[a{n}]')
        links.append(f'[v{n}][a{n}]')
    graph.append(''.join(links)+f'concat=n={len(segments)}:v=1:a=1[v][a]')
    E.log(f'Preset CTA: {clip.name} ({cta["duration"]:.2f}s); order: edited story -> CTA -> '+('thumbnail' if thumbnail_seconds else 'end'))
    E.run(['ffmpeg','-v','error','-y','-filter_complex_threads','2','-i',source,'-i',clip,'-filter_complex',';'.join(graph),'-map','[v]','-map','[a]','-c:v','libx264','-preset','veryfast','-crf','19','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart',output])
    result=E.probe(output)
    if abs(result['duration']-(info['duration']+cta['duration']))>max(.25,2/info['fps']):raise RuntimeError('Preset CTA output duration failed validation; prior final video preserved.')
    if not result['audio']:raise RuntimeError('Preset CTA output lost audio; prior final video preserved.')
    return output
