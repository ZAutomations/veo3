"""VEO3 adapter for the ported VideoAuotmation editing engines."""
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
PORT = ROOT / 'video_editing_port'
SETTINGS = ROOT / 'video_editing_settings.json'

FRAMELOOM_PRESETS = {
    'frameloom_bold_pop':dict(label='Frameloom · Bold Pop',font_family='Luckiest Guy',font_size=72,animation='highlight',highlight_color='#2BFF5A'),
    'frameloom_karaoke':dict(label='Frameloom · Karaoke Fill',font_family='Lilita One',font_size=72,animation='karaoke',highlight_color='#2BFF5A'),
    'frameloom_one_word':dict(label='Frameloom · One Word Punch',font_family='Anton',font_size=72,animation='one_word',highlight_color='#2BFF5A'),
    'frameloom_highlighter':dict(label='Frameloom · Highlighter Box',font_family='Titan One',font_size=72,animation='highlight',highlight_color='#2BFF5A'),
    'frameloom_smooth_rise':dict(label='Frameloom · Smooth Rise',font_family='Arial',font_size=72,animation='none',highlight_color='#2BFF5A'),
}



def log(message):
    print(f'[{time.strftime("%H:%M:%S")}] {message}', flush=True)


def schema():
    rows=json.loads((PORT / 'settings_schema.json').read_text(encoding='utf-8'))
    for row in rows:
        if row['key']=='clipper_caption_preset':
            row['choices'] += list(FRAMELOOM_PRESETS)
            if isinstance(row.get('choice_labels'),dict):row['choice_labels'].update({k:v['label'] for k,v in FRAMELOOM_PRESETS.items()})
    rows.append(dict(key='editing_camera_enabled',label='Camera transitions',default=False,page='finishing',group='Camera transitions'))
    rows.append(dict(key='editing_speed',label='Final video speed (×)',default=1.0,min=.15,max=2.0,step=.05,page='finishing',group='Final speed'))
    return rows


def defaults():
    result = {s['key']: s.get('default') for s in schema()}
    result.update(editing_auto_apply=True, editing_transitions_enabled=False,
                  silence_removal_enabled=False, clipper_captions_enabled=False,
                  editing_whisper_model='base', editing_preview_text='A little kindness can change everything.',
                  editing_transition_duration=.3)
    return result


def settings(values=None):
    result = defaults()
    if values is None and SETTINGS.is_file():
        values = json.loads(SETTINGS.read_text(encoding='utf-8-sig'))
    if not isinstance(values or {}, dict):
        raise ValueError('Invalid video editing settings.')
    result.update({k:v for k,v in (values or {}).items() if k in result})
    for spec in schema():
        key, value = spec['key'], result[spec['key']]
        default = spec.get('default')
        if isinstance(default, bool):
            if not isinstance(value, bool): raise ValueError(f'{key} must be enabled or disabled.')
        elif isinstance(default, (int,float)):
            if isinstance(value,bool): raise ValueError(f'Invalid {key}.')
            try: value=float(value)
            except (TypeError,ValueError): raise ValueError(f'Invalid {key}.')
            if not math.isfinite(value) or value < spec.get('min',-1e9) or value > spec.get('max',1e9):
                raise ValueError(f'{key} is outside the supported range.')
            result[key]=value
        elif spec.get('choices') and value not in spec['choices']:
            if key.startswith('transition_sfx_') and value in SFX_CHOICES: continue
            if key == 'clipper_override_font_family' and isinstance(value,str) and len(value)<150: continue
            raise ValueError(f'Choose a supported {spec.get("label",key)}.')
        if key.endswith('_color') and isinstance(value,str) and value and not re.fullmatch(r'#[a-fA-F0-9]{6}',value):
            if key != 'light_leak_color': raise ValueError(f'Invalid colour for {key}.')
    if result['editing_whisper_model'] not in ('tiny','base','small','medium','large-v3'):
        raise ValueError('Choose a supported caption transcription model.')
    if not .1 <= float(result['editing_transition_duration']) <= 1:
        raise ValueError('Transition duration must be between 0.1 and 1 second.')
    return result


SFX_CHOICES=['(default)','(none)','whoosh','swoosh','boom','glitch','chime','click','zap','sparkle',
             'hiss','rumble','shimmer','cinematic_whoosh','bass_drop','riser','impact','vinyl_brake',
             'notification','sub_boom','horn_stab']


def enabled(cfg):
    return any(cfg.get(k) for k in ('silence_removal_enabled','editing_transitions_enabled','editing_camera_enabled','clipper_captions_enabled')) or abs(float(cfg.get('editing_speed',1))-1)>1e-8


def run(command, cwd=None, timeout=3600):
    proc=subprocess.run([str(x) for x in command], cwd=cwd, capture_output=True, text=True,
                        encoding='utf-8', errors='replace', timeout=timeout,
                        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if proc.returncode:
        raise RuntimeError(f'{Path(str(command[0])).name} failed: {proc.stderr[-2500:]}')
    return proc


def probe(path):
    data=json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',path],timeout=45).stdout)
    video=next((s for s in data.get('streams',[]) if s.get('codec_type')=='video'),None)
    if not video: raise ValueError('The selected file has no video stream.')
    duration=float(data['format'].get('duration') or video.get('duration') or 0)
    num,den=(video.get('avg_frame_rate') or '25/1').split('/')
    return dict(width=int(video['width']),height=int(video['height']),duration=duration,
                fps=float(num)/max(1,float(den)),audio=any(s.get('codec_type')=='audio' for s in data['streams']))


def media_path(value):
    source=Path(str(value)).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() not in ('.mp4','.mov','.mkv','.webm','.m4v','.avi'):
        raise ValueError('Choose an existing video file.')
    return source


def keep_intervals(duration, silence_starts, silence_ends, padding):
    """Adapted source silence-removal segment planner; handles trailing silence."""
    silence=[]
    ends=iter(silence_ends)
    for start in silence_starts:
        end=next(ends,duration)
        silence.append((max(0,float(start)),min(duration,float(end))))
    cursor=0.;segments=[]
    for start,end in silence:
        keep_end=min(duration,start+padding) if start>.01 else 0.
        if keep_end>cursor+.05: segments.append((cursor,keep_end))
        cursor=duration if end>=duration-.01 else max(cursor,min(duration,end-padding))
    if cursor<duration-.05: segments.append((cursor,duration))
    merged=[]
    for start,end in segments:
        if merged and start-merged[-1][1]<.1: merged[-1]=(merged[-1][0],max(merged[-1][1],end))
        else: merged.append((start,end))
    return merged


def map_time(value, segments):
    return sum(max(0,min(float(value),end)-start) for start,end in segments if value>start)


def original_boundaries(source, report=None):
    report=Path(report) if report else source.parent/'JOINED_CLIP_ORDER.txt'
    if not report.is_file(): return []
    text=report.read_text(encoding='utf-8-sig')
    match=re.search(r'^Completed video:\s*(.+)$',text,re.M)
    if not match or Path(match.group(1).strip()).resolve()!=source.resolve(): return []
    return sorted(set(float(x) for x in re.findall(r'^\d+\s*\|\s*([\d.]+)s\s*\|',text,re.M) if float(x)>0))


def remove_silence(source, output, cfg, info):
    if not info['audio']:
        log('Silence removal skipped: video has no audio stream.')
        shutil.copy2(source,output);return [(0,info['duration'])]
    log(f"Detecting silence: {cfg['silence_threshold']} dB, minimum {cfg['silence_min_duration']}s, padding {cfg['silence_padding']}s.")
    result=run(['ffmpeg','-hide_banner','-i',source,'-af',
        f"silencedetect=noise={cfg['silence_threshold']}dB:d={cfg['silence_min_duration']}",'-f','null','-'],timeout=600)
    starts=[float(s) for s in re.findall(r'silence_start:\s+([\d.]+)',result.stderr)]
    ends=[float(s) for s in re.findall(r'silence_end:\s+([\d.]+)',result.stderr)]
    if not starts:
        log('No qualifying silence; preserving video.');shutil.copy2(source,output)
        return [(0,info['duration'])]
    segments=keep_intervals(info['duration'],starts,ends,float(cfg['silence_padding']))
    if not segments: raise ValueError('The whole video is below the silence threshold. Adjust the threshold; source was preserved.')
    # Use a shared frame-grid cut plan for audio and video. Time-only trim
    # rounding otherwise accumulates a partial frame at every retained region.
    fps=max(1,info['fps']);aligned=[]
    for start,end in segments:
        start=math.floor(start*fps)/fps;end=min(info['duration'],math.ceil(end*fps)/fps)
        if aligned and start<=aligned[-1][1]:aligned[-1]=(aligned[-1][0],end)
        else:aligned.append((start,end))
    segments=aligned
    from video_editing_port.source_effects import _ffmpeg_cut_concat
    if not _ffmpeg_cut_concat(source,output,segments,'ffmpeg',False,fps=fps):
        raise RuntimeError('The ported silence cut/concat engine could not render the video.')
    log(f"Removed {info['duration']-sum(e-s for s,e in segments):.2f}s; preserved {len(segments)} speech region(s).")
    return segments


# Source TransitionEffects methods, with the original duration and option keys.
TRANSITIONS={
 'transition_fade_in':('apply_fade_transition','in','transition_fade_in_duration','fade_in_duration',{}),
 'transition_fade_out':('apply_fade_transition','out','transition_fade_out_duration','fade_out_duration',{}),
 'transition_zoom_in':('create_zoom_transition','in','transition_zoom_in_duration','duration',{'zoom_in':True}),
 'transition_zoom_out':('create_zoom_transition','out','transition_zoom_out_duration','duration',{'zoom_in':False}),
 'transition_blur_in':('create_blur_transition','in','transition_blur_duration','duration',{'blur_in':True}),
 'transition_blur_out':('create_blur_transition','out','transition_blur_duration','duration',{'blur_in':False}),
 'transition_slide_in':('create_slide_transition','in','transition_slide_duration','duration',{'in_transition':True,'direction':'@transition_slide_direction'}),
 'transition_slide_out':('create_slide_transition','out','transition_slide_duration','duration',{'in_transition':False,'direction':'@transition_slide_direction'}),
 'transition_wipe_in':('create_wipe_transition','in','transition_wipe_duration','duration',{'in_transition':True,'direction':'@transition_wipe_direction'}),
 'transition_wipe_out':('create_wipe_transition','out','transition_wipe_duration','duration',{'in_transition':False,'direction':'@transition_wipe_direction'}),
 'transition_glitch_start':('create_glitch_transition','in','transition_glitch_duration','duration',{'glitch_start':True}),
 'transition_glitch_end':('create_glitch_transition','out','transition_glitch_duration','duration',{'glitch_start':False}),
 'transition_bounce':('create_bounce_transition','in','transition_bounce_duration','duration',{'bounce_start':True}),
 'transition_bounce_mask':('create_bounce_mask_transition','in','transition_bounce_mask_duration','duration',{}),
 'transition_mask':('create_mask_reveal','in','transition_mask_duration','duration',{}),
 'transition_cinematic_bars':('create_cinematic_bars','in','transition_bars_duration','duration',{}),
 'transition_radial_wipe':('create_radial_wipe','in','transition_radial_wipe_duration','duration',{}),
 'transition_color_dissolve':('create_color_dissolve','in','transition_color_dissolve_duration','duration',{}),
 'transition_split_wipe':('create_split_wipe','in','transition_split_wipe_duration','duration',{}),
 'transition_luma_wipe':('create_luma_wipe','in','transition_luma_wipe_duration','duration',{}),
}


def render_transitions(source,output,boundaries,cfg,silence_boundaries=()):
    if not any(cfg.get(key) for key in TRANSITIONS):
        log('Camera transitions enabled but no effect selected: skipping transitions; continuing remaining editing.')
        shutil.copy2(source,output)
        return
    from moviepy import VideoFileClip, concatenate_videoclips, CompositeAudioClip
    from video_editing_port.source_effects import TransitionEffects, _make_sfx_clip, _resolve_sfx_for_transition
    resources=[]
    try:
        clip=VideoFileClip(str(source));resources.append(clip)
        points=[0]+[x for x in boundaries if .05<x<clip.duration-.05]+[clip.duration]
        effects=[k for k in TRANSITIONS if cfg.get(k)]
        if len(points)<3:
            log('No verified clip boundaries: transitions skipped; standalone files need a matching JOINED_CLIP_ORDER.txt.')
            shutil.copy2(source,output);return
        pieces=[];sfx=[]
        for i,(start,end) in enumerate(zip(points,points[1:])):
            part=clip.subclipped(start,end)
            resources.append(part)
            for name in effects:
                method,direction,dur_key,dur_arg,kwargs=TRANSITIONS[name]
                if direction=='in' and i==0 or direction=='out' and i==len(points)-2: continue
                duration=min(float(cfg.get(dur_key,.3)),(end-start)/2)
                boundary=start if direction=='in' else end
                if cfg.get('silence_transition_enabled') and any(abs(boundary-cut)<.02 for cut in silence_boundaries):
                    duration=min(duration,float(cfg['silence_transition_duration']))
                args={k:cfg.get(v[1:]) if isinstance(v,str) and v.startswith('@') else v for k,v in kwargs.items()}
                args[dur_arg]=duration
                if method=='create_zoom_transition':args['zoom_scale']=cfg['transition_zoom_scale']
                if method=='create_blur_transition':args['max_blur']=cfg['transition_blur_amount']
                if method in ('create_mask_reveal','create_bounce_mask_transition'):
                    args.update(shape=cfg['transition_mask_shape'],bg_color=cfg['transition_mask_color'])
                if method=='create_glitch_transition':args['intensity']=cfg['transition_glitch_intensity']
                if method=='create_bounce_transition':args['height']=cfg['transition_bounce_height']
                if method=='create_cinematic_bars':args['bar_height_percent']=cfg['transition_bars_height']
                if method in ('create_radial_wipe','create_color_dissolve','create_split_wipe','create_luma_wipe'):
                    suffix=method.replace('create_','')
                    args['direction']=cfg.get('transition_'+suffix+'_direction','in')
                # Use the original visual method; no overlapping timelines or cut dialogue.
                part=getattr(TransitionEffects,method)(part,**args)
                if cfg.get('transition_sfx_enabled') and float(cfg['transition_sfx_volume'])>0:
                    override=cfg.get('transition_sfx_'+name.removeprefix('transition_'),'(default)')
                    if override=='(none)':continue
                    sname,custom,volume=_resolve_sfx_for_transition(cfg,name,name.removeprefix('transition_'))
                    audio=_make_sfx_clip(sname or 'swoosh',min(.6,duration),start if direction=='in' else max(start,end-duration),44100,float(cfg['transition_sfx_volume']),custom,volume)
                    if audio is None: raise RuntimeError('The selected transition sound could not be rendered.')
                    sfx.append(audio);resources.append(audio)
            pieces.append(part);resources.append(part)
        result=concatenate_videoclips(pieces,method='chain');resources.append(result)
        if sfx:
            mix=CompositeAudioClip(([clip.audio] if clip.audio else [])+sfx).with_duration(clip.duration)
            resources.append(mix);result=result.with_audio(mix);resources.append(result)
        log(f'Applying source camera effects and {len(sfx)} swoosh/SFX event(s) at {len(points)-2} verified boundary/boundaries.')
        result.write_videofile(str(output),codec='libx264',audio_codec='aac',fps=clip.fps,
                               preset='veryfast',threads=2,logger=None)
    finally:
        for item in reversed(resources):
            try:item.close()
            except Exception:pass


def render_camera_transitions(source,output,boundaries,duration=.35):
    """Sideways camera-style swipe at verified joins; no zoom, blur or dissolve.

    Outgoing visual tails and incoming frames share the existing timeline.
    Audio is not overlapped, trimmed or regenerated.
    """
    import numpy as np
    from moviepy import VideoFileClip
    clip=VideoFileClip(str(source));result=None
    try:
        cuts=sorted(set(float(t) for t in boundaries if .05<float(t)<clip.duration-.05))
        if not cuts:
            log('Camera transitions ON but no verified clip joins: skipped.')
            shutil.copy2(source,output);return
        spans=[]
        for i,cut in enumerate(cuts):
            previous=cuts[i-1] if i else 0
            following=cuts[i+1] if i+1<len(cuts) else clip.duration
            spans.append((cut,min(duration,(cut-previous)/2,(following-cut)/2),i))
        def swipe(get_frame,t):
            incoming=get_frame(t)
            for cut,length,index in spans:
                if cut<=t<cut+length:
                    progress=(t-cut)/length
                    # Smooth accelerate/decelerate, complete within the join.
                    progress=progress*progress*(3-2*progress)
                    outgoing=get_frame(max(0,cut-length+t-cut))
                    width=incoming.shape[1];shift=round(width*progress)
                    if not shift:return outgoing
                    if shift>=width:return incoming
                    if index%2:
                        return np.concatenate((incoming[:,-shift:],outgoing[:,:width-shift]),axis=1)
                    return np.concatenate((outgoing[:,shift:],incoming[:,:shift]),axis=1)
            return incoming
        result=clip.transform(swipe)
        log(f'Applying camera pan/swipe at {len(spans)} verified clip join(s); no zoom, blur or dissolve; audio timing unchanged.')
        result.write_videofile(str(output),codec='libx264',audio_codec='aac',fps=clip.fps,preset='veryfast',threads=2,logger=None)
    finally:
        if result is not None:result.close()
        clip.close()


def render_dissolve(source,output,boundaries,duration=.3):
    """Blend the outgoing tail into the incoming clip, keeping the audio clock."""
    import numpy as np
    from moviepy import VideoFileClip
    clip=VideoFileClip(str(source));result=None
    try:
        cuts=sorted(set(float(t) for t in boundaries if .05<float(t)<clip.duration-.05))
        if not cuts:
            log('No verified clip joins: dissolve skipped.')
            shutil.copy2(source,output);return
        spans=[]
        for i,cut in enumerate(cuts):
            previous=cuts[i-1] if i else 0
            following=cuts[i+1] if i+1<len(cuts) else clip.duration
            length=min(duration,(cut-previous)/2,(following-cut)/2)
            spans.append((cut,length))
        def blend(get_frame,t):
            frame=get_frame(t)
            for cut,length in spans:
                if cut<=t<cut+length:
                    weight=(t-cut)/length
                    outgoing=get_frame(max(0,cut-length+(t-cut)))
                    return np.clip(outgoing.astype(float)*(1-weight)+frame.astype(float)*weight,0,255).astype('uint8')
            return frame
        result=clip.transform(blend)
        log(f'Applying dissolve at {len(spans)} verified clip join(s); audio and duration unchanged.')
        result.write_videofile(str(output),codec='libx264',audio_codec='aac',fps=clip.fps,preset='veryfast',threads=2,logger=None)
    finally:
        if result is not None:result.close()
        clip.close()


def crossfade_silence_segments(source,output,segments,cfg):
    """Port of the standalone card's CrossFadeIn/Out + click composition."""
    from moviepy import VideoFileClip,CompositeVideoClip,CompositeAudioClip,vfx
    from video_editing_port.source_effects import _make_sfx_clip
    resources=[]
    try:
        source_clip=VideoFileClip(str(source));resources.append(source_clip)
        lengths=[end-start for start,end in segments]
        overlap=min(float(cfg['silence_crossfade_duration']),min(lengths)/2)
        pieces=[];sounds=[];cursor=0.
        for i,duration in enumerate(lengths):
            part=source_clip.subclipped(cursor,min(source_clip.duration,cursor+duration));cursor+=duration
            resources.append(part)
            effects=[]
            if i:effects.append(vfx.CrossFadeIn(overlap))
            if i<len(lengths)-1:effects.append(vfx.CrossFadeOut(overlap))
            part=part.with_effects(effects).with_start(sum(lengths[:i])-overlap*i)
            resources.append(part);pieces.append(part)
            if i and cfg['transition_sfx_enabled']:
                sound=_make_sfx_clip('click',min(overlap,.3),part.start+overlap/2,44100,float(cfg['transition_sfx_volume']))
                if sound is None:raise RuntimeError('Crossfade click sound could not be generated.')
                resources.append(sound);sounds.append(sound)
        result=CompositeVideoClip(pieces).with_duration(sum(lengths)-overlap*(len(lengths)-1));resources.append(result)
        if sounds:
            mix=CompositeAudioClip(([result.audio] if result.audio else [])+sounds).with_duration(result.duration)
            resources.append(mix);result=result.with_audio(mix);resources.append(result)
        result.write_videofile(str(output),codec='libx264',audio_codec='aac',fps=source_clip.fps,preset='veryfast',threads=2,logger=None)
        log(f'Applied source crossfade + click: {len(lengths)-1} cuts, {overlap:.2f}s overlap.')
        return overlap
    finally:
        for resource in reversed(resources):
            try:resource.close()
            except Exception:pass


def transcribe(source,folder,cfg):
    fingerprint=hashlib.sha256((str(source.resolve())+str(source.stat().st_size)+str(source.stat().st_mtime_ns)+cfg['editing_whisper_model']+str(cfg['caption_language'])).encode()).hexdigest()[:16]
    target=folder/f'words_{fingerprint}.json'
    if not target.is_file():
        log('Transcribing final edited speech locally for word-level caption timing...')
        command=[sys.executable,PORT/'_whisper_word_timestamps.py',source,'--output',target,'--model',cfg['editing_whisper_model']]
        lang={'english':'en','russian':'ru','arabic':'ar','urdu':'ur','japanese':'ja','chinese':'zh','korean':'ko','hindi':'hi','thai':'th'}.get(cfg['caption_language'])
        if lang:command+=['--language',lang]
        run(command,timeout=3600)
    rows=json.loads(target.read_text(encoding='utf-8'))
    words=[]
    for row in rows:
        start=float(row.get('start',row.get('offset',0)))
        end=float(row.get('end',start+float(row.get('duration',0))))
        text=str(row.get('word',row.get('text',''))).strip()
        if end>start and text:words.append(dict(word=text,start=start,end=end))
    return words


def build_captions(words,path,info,cfg):
    from video_editing_port.clipper_captions import get_preset,build_ass_from_settings
    from video_editing_port import caption_fonts
    if cfg['clipper_caption_preset'] in FRAMELOOM_PRESETS:
        from video_editing_port import frameloom_captions as fc
        name=cfg['clipper_caption_preset'].removeprefix('frameloom_')
        timed=[]
        for word in words:
            start=max(0,float(word['start'])+float(cfg['caption_sync_offset']))
            end=min(info['duration'],float(word['end'])+float(cfg['caption_sync_offset']))
            text=str(word['word'])
            if cfg['caption_text_case']=='Title Case':text=text.title()
            if end>start:timed.append(dict(word=text,start=start,end=end))
        overrides=dict(highlight_color=cfg.get('clipper_override_highlight_color') or '#2BFF5A',
            size_scale=float(cfg['caption_font_size'])/72,words_per_phrase=int(cfg['caption_words_per_line']),
            font_family=cfg.get('clipper_override_font_family') or fc.STYLES[name][1],
            uppercase=cfg['caption_text_case']=='ALL CAPS',y_offset=cfg['caption_y_offset'])
        text=fc.build_ass(None,info['width'],info['height'],dict(enabled=True,style=name,color='green',
            position='middle' if cfg['caption_position']=='center' else cfg['caption_position'],size='medium'),
            word_items=timed,overrides=overrides)
        path.write_text(text,encoding='utf-8-sig')
        fonts=path.parent/'fonts';fonts.mkdir(exist_ok=True)
        font=caption_fonts.resolve_font_path(overrides['font_family'])
        if not font:raise ValueError('Caption font unavailable: '+overrides['font_family'])
        shutil.copy2(font,fonts/Path(font).name)
        return timed
    preset=get_preset(cfg['clipper_caption_preset'])
    overrides={'position':cfg['caption_position'],'max_words':int(cfg['caption_words_per_line']),
               'max_lines':{'1-line':1,'2-line':2,'multi-line':3}.get(cfg['caption_layout'],2),
               'font_scale':float(cfg['caption_font_size'])/preset['font_size'],
               'uppercase':cfg['caption_text_case']=='ALL CAPS',
               'karaoke':cfg['clipper_caption_animation']=='karaoke',
               'background_enabled':bool(cfg['clipper_override_bg_enabled'])}
    for source,dest in [('highlight_color','highlight_color'),('primary_color','primary_color'),('stroke_color','outline_color'),('font_family','font_family'),('stroke','outline'),('bold','bold')]:
        value=cfg.get('clipper_override_'+source)
        if value:overrides[dest]=value
    if cfg['clipper_override_bg_enabled']:
        overrides.update(background_enabled=True,background_color=cfg['clipper_override_bg_color'] or '#000000',background_opacity=cfg['clipper_override_bg_opacity'])
    yoff=float(cfg['caption_y_offset'])
    if yoff:overrides.update(pos_x=50,pos_y={'top':8,'center':50,'bottom':92}[cfg['caption_position']]+yoff/info['height']*100)
    timed=[]
    for word in words:
        start=max(0,float(word['start'])+float(cfg['caption_sync_offset']))
        end=min(info['duration'],float(word['end'])+float(cfg['caption_sync_offset']))
        text=word['word'].title() if cfg['caption_text_case']=='Title Case' else word['word']
        if end>start:timed.append(dict(word=text,start=start,end=end))
    build_ass_from_settings(timed,cfg['clipper_caption_preset'],info['width'],info['height'],path,
                            overrides=overrides,animation=cfg['clipper_caption_animation'])
    fonts=path.parent/'fonts';fonts.mkdir(exist_ok=True)
    family=overrides.get('font_family',preset['font_family'])
    font=caption_fonts.resolve_font_path(family)
    if not font:raise ValueError(f'Caption font {family} is unavailable. Select a bundled or installed font.')
    shutil.copy2(font,fonts/Path(font).name)
    return timed


def tempo_filters(speed):
    # Each atempo stage stays within 0.5–2 for pitch-preserving slow motion.
    factors=[];remaining=float(speed)
    while remaining<.5:
        factors.append(.5);remaining/=.5
    factors.append(remaining)
    return ','.join(f'atempo={factor:.10g}' for factor in factors)


def apply_speed(source,output,speed):
    speed=float(speed)
    if not math.isfinite(speed) or not .15<=speed<=2:raise ValueError('Speed must be between 0.15× and 2.00×.')
    info=probe(source);duration=info['duration']/speed
    log(f'Final speed: {speed:.2f}× after all effects; pitch-preserving audio.')
    vf=f'setpts=(PTS-STARTPTS)/{speed:.10g},fps={info["fps"]:.10g},tpad=stop_mode=clone:stop_duration=1,trim=duration={duration:.10g}'
    args=['ffmpeg','-v','error','-y','-i',source,'-map','0:v:0','-vf',vf]
    if info['audio']:
        args+=['-map','0:a:0','-af',f'asetpts=PTS-STARTPTS,{tempo_filters(speed)},apad,atrim=duration={duration:.10g}','-c:a','aac']
    else:args+=['-an']
    args+=['-t',str(duration),'-c:v','libx264','-preset','veryfast','-crf','19','-movflags','+faststart',output]
    run(args)
    result=probe(output)
    if abs(result['duration']-duration)>max(.2,2/max(1,info['fps'])):raise RuntimeError('Speed output duration failed validation.')
    if info['audio'] and not result['audio']:raise RuntimeError('Speed output lost its audio.')


def edit(source,values=None,report=None,output=None):
    source=media_path(source);cfg=settings(values);info=probe(source)
    if not enabled(cfg):log('All editing features are disabled; original video retained.');return source
    if cfg['clipper_captions_enabled'] and not info['audio']:raise ValueError('Captions require an audio stream; disable captions for this silent video.')
    final=Path(output).resolve() if output else source.with_name(source.stem+'_edited.mp4')
    if final==source:raise ValueError('Edited output must be a different file from the original.')
    folder=source.parent/'video_editing';folder.mkdir(exist_ok=True)
    signature=hashlib.sha256((str(source)+str(source.stat().st_size)+str(source.stat().st_mtime_ns)+json.dumps(cfg,sort_keys=True)).encode()).hexdigest()
    receipt=folder/'last_edit.json'
    if receipt.is_file():
        saved=json.loads(receipt.read_text(encoding='utf-8'))
        if cfg.get('silence_skip_done',True) and saved.get('signature')==signature and saved.get('output')==str(final) and final.is_file():
            probe(final);log(f'Existing edited output already matches these settings: {final}');return final
    work=folder/signature[:16];work.mkdir(exist_ok=True)
    current=source;segments=[(0,info['duration'])]
    boundaries=original_boundaries(source,report)
    log(f'Dissolve: {"ON" if cfg["editing_transitions_enabled"] else "OFF"}; {len(boundaries)} verified clip join(s).')
    log(f'Camera transitions: {"ON" if cfg["editing_camera_enabled"] else "OFF"}.')
    if cfg['silence_removal_enabled']:
        current=work/'silence_removed.mp4';segments=remove_silence(source,current,cfg,info)
    mapped=sorted(set(map_time(t,segments) for t in boundaries))
    cut_times=[sum(e-s for s,e in segments[:i]) for i in range(1,len(segments))]
    if cfg['silence_transition_enabled']:
        mapped=sorted(set(mapped+cut_times))
    overlap=0.
    if cfg['silence_crossfade_enabled'] and len(segments)>1:
        target=work/'crossfaded.mp4';overlap=crossfade_silence_segments(current,target,segments,cfg);current=target
        mapped=sorted(set(max(0,value-overlap*sum(cut<=value for cut in cut_times)) for value in mapped))
    silence_mapped=[max(0,cut-overlap*(i+1)) for i,cut in enumerate(cut_times)]
    if cfg['editing_camera_enabled']:
        target=work/'camera_transitions.mp4';render_camera_transitions(current,target,mapped);current=target
    if cfg['editing_transitions_enabled']:
        target=work/'transitions.mp4';render_dissolve(current,target,mapped,float(cfg['editing_transition_duration']));current=target
    if cfg['clipper_captions_enabled']:
        final_info=probe(current);words=transcribe(current,work,cfg)
        if not words:raise ValueError('No spoken words detected. Disable captions or choose a different transcription language/model.')
        ass=work/'captions.ass';build_captions(words,ass,final_info,cfg)
        target=work/'captioned.mp4'
        log('Burning captions (ASS) with the selected preset/font/animation engine...')
        run(['ffmpeg','-v','error','-y','-i',current,'-vf','ass=captions.ass:fontsdir=fonts',
             '-c:v','libx264','-preset','veryfast','-crf','19','-c:a','copy','-movflags','+faststart',target],cwd=work)
        current=target
        shutil.copy2(ass,folder/'captions.ass')
    result=probe(current)
    expected=sum(end-start for start,end in segments)-overlap*(len(segments)-1)
    if abs(result['duration']-expected)>max(.2,2/max(1,info['fps'])):raise RuntimeError('Edited video duration failed validation; original was preserved.')
    if info['audio'] and not result['audio']:raise RuntimeError('Edited output lost its audio stream; original was preserved.')
    if abs(float(cfg['editing_speed'])-1)>1e-8:
        target=work/'speed_adjusted.mp4';apply_speed(current,target,cfg['editing_speed']);current=target
        result=probe(current)
    staging=final.with_name(final.stem+f'.building_{os.getpid()}.mp4');shutil.copy2(current,staging);os.replace(staging,final)
    receipt.write_text(json.dumps(dict(signature=signature,input=str(source),output=str(final),settings=cfg,
        keep_intervals=segments,transition_boundaries=[t/float(cfg['editing_speed']) for t in mapped],speed=cfg['editing_speed'],duration=result['duration']),indent=2),encoding='utf-8')
    log(f'EDITED_VIDEO: {final}')
    return final


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('video');parser.add_argument('--auto',action='store_true');parser.add_argument('--order-report')
    parser.add_argument('--request');parser.add_argument('--out')
    args=parser.parse_args()
    if Path(args.video).suffix.lower()=='.json' and not args.request:
        request=json.loads(Path(args.video).read_text(encoding='utf-8'))
        edit(request['video'],request.get('settings'),request.get('order_report'),request.get('out'));return
    values=json.loads(Path(args.request).read_text(encoding='utf-8')) if args.request else json.loads(os.environ['VEO_EDITING_SETTINGS']) if args.auto and os.environ.get('VEO_EDITING_SETTINGS') else None
    cfg=settings(values)
    if args.auto and not cfg['editing_auto_apply']:return
    edit(args.video,cfg,args.order_report,args.out)


if __name__=='__main__':
    try:main()
    except ValueError as error:
        log(f'RECOVERY_REVIEW_REQUIRED: Video Editing settings/source need attention: {error}');sys.exit(2)
    except Exception as error:
        log(f'VIDEO EDITING FAILED: {error}');sys.exit(1)
