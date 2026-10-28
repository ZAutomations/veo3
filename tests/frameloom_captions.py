import sys,tempfile,pathlib,importlib.util
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import video_editing as e
from video_editing_port import frameloom_captions as f
# Verify copied math against original installed renderer, with identical words.
source=pathlib.Path(r'C:\Users\AL AZIZ TECH\AppData\Local\Programs\Frameloom\app\vidgen\captions.py')
original=None
if source.is_file():
    spec=importlib.util.spec_from_file_location('original_captions',source);original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
words=[dict(word=w,start=i*.4,end=(i+1)*.4) for i,w in enumerate(['Up','forty','thousand','feet.'])]
if original:original._words=lambda _: [(w['word'],w['start'],w['end']) for w in words]
with tempfile.TemporaryDirectory() as tmp:
    root=pathlib.Path(tmp)
    for name in f.STYLES:
        setting=dict(enabled=True,style=name,color='green',position='middle',size='medium')
        if original:assert f.build_ass(None,720,1280,setting,word_items=words)==original.build_ass(None,720,1280,setting),name
        cfg=e.settings(dict(clipper_captions_enabled=True,clipper_caption_preset='frameloom_'+name,
            caption_font_size=72,caption_position='center',caption_text_case='ALL CAPS' if name in ('bold_pop','one_word','highlighter') else 'Normal'))
        out=root/(name+'.ass');e.build_captions(words,out,dict(width=720,height=1280,duration=3),cfg)
        body=out.read_text(encoding='utf-8-sig');assert 'Dialogue:' in body and f.STYLES[name][1] in body
        required={'bold_pop':r'\fscx118','karaoke':r'\kf','one_word':r'\fscx55','highlighter':r'\bord','smooth_rise':r'\move'}[name]
        assert required in body,name
        e.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=0x27313d:s=720x1280:r=24:d=3',
            '-vf',f'ass={name}.ass:fontsdir=fonts','-frames:v','1',root/(name+'.png')],cwd=root)
        assert (root/(name+'.png')).stat().st_size>5000
print('PASS: all five Frameloom renderer outputs exactly match original source with default settings; adapter fonts, timing, scaling and FFmpeg burns work.')
