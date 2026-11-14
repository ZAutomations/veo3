"""Local speech/music separation ported from Video Automation Studio's Demucs path.
Only the instrumental stem is accepted. Failures never fall back to original speech.
"""
from pathlib import Path
import hashlib,json,os,subprocess,sys
import video_editing as E

def resolve_python(configured=''):
    candidates=[configured,os.environ.get('VEO_SEPARATION_PYTHON',''),sys.executable,str(E.ROOT/'.separation-venv/Scripts/python.exe'),str(Path(os.environ.get('LOCALAPPDATA',''))/'Programs/Python/Python311/python.exe')]
    for p in dict.fromkeys(x for x in candidates if x):
        if not Path(p).is_file() and p!=sys.executable:continue
        try:
            r=subprocess.run([p,'-c','import demucs,torch,numpy,soundfile;print("ready")'],capture_output=True,text=True,timeout=30,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if r.returncode==0:return p
        except (OSError,subprocess.TimeoutExpired):pass
    raise ValueError('Demucs runtime is unavailable. Choose your existing dubbing Python or run Setup/INSTALL_SEPARATION.bat. No original speech was mixed back.')

def identity(source):
    p=Path(source).resolve();h=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def prepare_background(video,folder,python=''):
    video=Path(video).resolve();folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    digest=identity(video);work=folder/digest[:20];work.mkdir(exist_ok=True)
    output=work/'background.mp4';receipt=work/'SEPARATION_READY.json';info=E.probe(video)
    if output.is_file() and receipt.is_file():
        saved=json.loads(receipt.read_text())
        if saved.get('sha256')==digest and saved.get('model')=='htdemucs' and abs(E.probe(output)['duration']-info['duration'])<.1:
            print('LOCAL DUBBING: reusing cached BGM/SFX separation.',flush=True);return output
    if not info['audio']:
        E.run(['ffmpeg','-v','error','-y','-i',video,'-f','lavfi','-i','anullsrc=r=44100:cl=stereo','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-t',str(info['duration']),output])
    else:
        py=resolve_python(python);original=work/'original.wav'
        E.run(['ffmpeg','-v','error','-y','-i',video,'-vn','-ar','44100','-ac','2',original])
        env=dict(os.environ);private=Path(py).parent.parent/'torch_cache'
        if private.is_dir():env['TORCH_HOME']=str(private)
        log=work/'separation.log'
        command=[py,'-m','demucs','--two-stems','vocals','-n','htdemucs','-d','cpu','--shifts','0','--segment','6','--float32','-o',str(work/'stems'),str(original)]
        print('LOCAL DUBBING: separating English speech from music/SFX (one cached pass per source video).',flush=True)
        with log.open('w',encoding='utf-8') as f:
            try:r=subprocess.run(command,stdout=f,stderr=subprocess.STDOUT,env=env,timeout=1800,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            except subprocess.TimeoutExpired:raise ValueError('Separation timed out; no original speech fallback. See '+str(log)) from None
        stem=work/'stems/htdemucs/original/no_vocals.wav'
        if r.returncode or not stem.is_file():raise ValueError('Speech separation failed; no original speech fallback. See '+str(log))
        staging=work/'background.building.mp4'
        E.run(['ffmpeg','-v','error','-y','-i',video,'-i',stem,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-af','apad','-t',str(info['duration']),staging]);staging.replace(output)
    if abs(E.probe(output)['duration']-info['duration'])>.1:raise ValueError('Separated background duration changed; dubbing stopped.')
    receipt.write_text(json.dumps({'sha256':digest,'source':str(video),'model':'htdemucs','output':str(output),'note':'AI separation is approximate; speech leakage or SFX changes require listening review.'},indent=2),encoding='utf-8')
    return output
