"""Local UI and exact libass preview adapter for the ported editing engines."""
from pathlib import Path
import base64
import hashlib
import json
import os
import re
import threading
import uuid

from fastapi import HTTPException
from fastapi.responses import FileResponse
import video_editing as editor

SESSIONS={}
GUARD=threading.RLock()


def manifest():
    from video_editing_port.clipper_captions import STYLE_PRESETS
    from video_editing_port.caption_fonts import list_fonts
    return dict(settings=editor.settings(),schema=editor.schema(),presets=[dict(id=k,**v) for k,v in {**STYLE_PRESETS,**editor.FRAMELOOM_PRESETS}.items()],
                fonts=sorted({font['family'] for group in list_fonts().values() for font in group} | {'Arial'}),sfx=editor.SFX_CHOICES)


def prepare_preview(payload):
    cfg=editor.settings(payload.get('settings'))
    source=editor.media_path(payload['video']) if payload.get('video') else None
    session=uuid.uuid4().hex;folder=editor.ROOT/'logs'/'video_editing_previews'/session;folder.mkdir(parents=True)
    if source:
        info=editor.probe(source)
    else:
        source=folder/'sample.mp4'
        editor.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=0x27313d:s=1280x720:r=24:d=8',
                    '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',source])
        info=editor.probe(source)
    sample=not payload.get('actualWords')
    words=[]
    if not sample:
        if not info['audio']:raise ValueError('The selected video has no audio. Use sample text preview.')
        cache=source.parent/'video_editing_preview_cache';cache.mkdir(exist_ok=True)
        words=editor.transcribe(source,cache,cfg)
        if not words:raise ValueError('No speech was detected. Use sample text preview.')
    with GUARD:SESSIONS[session]=dict(source=source,folder=folder,info=info,words=words,sample=sample,render_lock=threading.Lock())
    return dict(session=session,info=info,sample=sample,wordCount=len(words))


def frame(payload, playable=False):
    with GUARD:session=SESSIONS.get(str(payload.get('session','')))
    if not session:raise ValueError('Load a preview video first.')
    cfg=editor.settings(payload.get('settings'));info=session['info']
    when=max(0,min(float(payload.get('time',0)),max(0,info['duration']-.1)))
    folder=session['folder'];source=session['source']
    with session['render_lock']:
        words=session['words']
        if session['sample']:
            tokens=str(cfg['editing_preview_text'] or 'A little kindness can change everything.').split()
            step=min(.5,info['duration']/max(1,len(tokens)))
            words=[dict(word=word,start=i*step,end=(i+1)*step) for i,word in enumerate(tokens)]
        ass=folder/'captions.ass';editor.build_captions(words,ass,info,cfg)
        # Input seek resets PTS. Restore the original clock before libass so
        # scrubbing and animation use the same timestamps as the full export.
        vf=f'setpts=PTS-STARTPTS+{when+.001:.6f}/TB,ass=captions.ass:fontsdir=fonts,setpts=PTS-STARTPTS' if cfg['clipper_captions_enabled'] else 'setpts=PTS-STARTPTS'
        if playable:
            target=folder/f'preview_{uuid.uuid4().hex}.mp4'
            editor.run(['ffmpeg','-v','error','-y','-ss',str(when),'-i',source,'-t',str(min(5,info['duration']-when)),
                        '-vf',vf,'-c:v','libx264','-preset','ultrafast','-crf','22','-c:a','aac','-movflags','+faststart',target],cwd=folder)
            if abs(float(cfg['editing_speed'])-1)>1e-8:
                sped=folder/f'preview_{uuid.uuid4().hex}.mp4'
                editor.apply_speed(target,sped,cfg['editing_speed']);target=sped
            return target
        target=folder/'frame.jpg'
        editor.run(['ffmpeg','-v','error','-y','-ss',str(when),'-i',source,'-vf',vf,
                    '-frames:v','1','-q:v','2',target],cwd=folder,timeout=90)
        return dict(image='data:image/jpeg;base64,'+base64.b64encode(target.read_bytes()).decode('ascii'),time=when)


def install(app, token, save_json):
    @app.post('/api/video-editing/source')
    def story_video(payload:dict):
        story=Path(str(payload.get('story',''))).resolve()
        if not story.is_file() or story.suffix.lower()!='.json':raise HTTPException(400,'Choose a saved story.')
        report=story.parent/'JOINED_CLIP_ORDER.txt'
        if report.is_file():
            match=re.search(r'^Completed video:\s*(.+)$',report.read_text(encoding='utf-8-sig'),re.M)
            if match:
                source=Path(match.group(1).strip()).resolve()
                if source.parent==story.parent and source.is_file():return dict(video=str(source))
        candidates=list(story.parent.glob('*_final.mp4'))
        if len(candidates)!=1:raise HTTPException(400,'Join this story first, or select its combined video with Browse video.')
        return dict(video=str(candidates[0]))

    @app.get('/api/video-editing')
    def get_settings():
        try:return manifest()
        except (ValueError,OSError) as e:raise HTTPException(400,str(e))

    @app.post('/api/video-editing/settings')
    def save_settings(payload:dict):
        try:cfg=editor.settings(payload)
        except (ValueError,TypeError) as e:raise HTTPException(400,str(e))
        save_json(editor.SETTINGS,cfg);return dict(ok=True,settings=cfg)

    @app.post('/api/video-editing/prepare')
    def prepare(payload:dict):
        try:return prepare_preview(payload)
        except Exception as e:raise HTTPException(400,str(e))

    @app.post('/api/video-editing/frame')
    def preview_frame(payload:dict):
        try:return frame(payload)
        except Exception as e:raise HTTPException(400,str(e))

    @app.post('/api/video-editing/play')
    def preview_video(payload:dict):
        try:
            path=frame(payload,True)
            return dict(url=f'/editing-preview/{token}/{payload["session"]}/{path.name}')
        except Exception as e:raise HTTPException(400,str(e))

    @app.get('/editing-preview/{session_token}/{session_id}/{name}')
    def preview_media(session_token:str,session_id:str,name:str):
        import secrets
        if not secrets.compare_digest(session_token,token):raise HTTPException(403,'Invalid preview session.')
        with GUARD:session=SESSIONS.get(session_id)
        if not session or not re.fullmatch(r'preview_[a-f0-9]{32}\.mp4',name):raise HTTPException(404)
        path=session['folder']/name
        if not path.is_file():raise HTTPException(404)
        return FileResponse(path,media_type='video/mp4')
