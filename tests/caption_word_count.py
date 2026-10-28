import sys,tempfile,pathlib,re
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import video_editing as e
words=[dict(word=w,start=i*.4,end=(i+1)*.4) for i,w in enumerate(['one','two','three','four','five','six'])]
with tempfile.TemporaryDirectory() as tmp:
    for style in e.FRAMELOOM_PRESETS:
        for count in [1,2,3,5]:
            cfg=e.settings(dict(clipper_caption_preset=style,caption_words_per_line=count))
            out=pathlib.Path(tmp)/'captions.ass'
            e.build_captions(words,out,dict(width=720,height=1280,duration=3),cfg)
            rows=[r.split(',,',2)[-1] for r in out.read_text(encoding='utf-8-sig').splitlines() if r.startswith('Dialogue:')]
            visible=[re.sub(r'\{[^}]*\}','',row).split() for row in rows]
            limit=1 if style=='frameloom_one_word' else count
            assert visible and all(len(row)<=limit for row in visible),(style,count,visible)
print('PASS: all five caption styles respect 1/2/3/5 word limits; One Word Punch remains one word.')
