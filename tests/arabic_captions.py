import sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from video_editing_port import frameloom_captions as F
from video_editing_port import clipper_captions as C
words=[dict(word=w,start=i*.7,end=(i+1)*.7) for i,w in enumerate(['تدفق','الدم','إلى','الدماغ'])]
for style in F.STYLES:
 text=F.build_ass(None,720,1280,dict(enabled=True,style=style,color='green',position='middle',size='medium'),word_items=words,overrides={'words_per_phrase':4})
 row=next(x for x in text.splitlines() if x.startswith('Style: Arabic,'));fields=row.split(',')
 assert fields[1]=='Noto Sans Arabic' and fields[14]=='0' and fields[-1]=='-1'
 assert ',Arabic,,' in text
 assert 'تدفق' in text and 'قفدت' not in text
text=F.build_ass(None,720,1280,dict(enabled=True,style='bold_pop',color='green',position='middle',size='medium'),word_items=[dict(word='English',start=0,end=1)])
assert ',Latin,,' in text
with tempfile.TemporaryDirectory() as tmp:
 p=Path(tmp)/'captions.ass'
 C.build_ass(words,C.DEFAULT_PRESET,720,1280,p,overrides={'font_family':'Noto Sans Arabic','tracking':0})
 text=p.read_text(encoding='utf-8-sig')
assert next(x for x in text.splitlines() if x.startswith('Style: Default,')).endswith(',-1')
print('PASS: Arabic font/zero spacing/whole-line bidi across five animated styles and legacy ASS; Unicode order preserved; English stays Latin.')
