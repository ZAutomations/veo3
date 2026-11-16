"""Verified continuous narration can reuse its preparation word timestamps."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import hashlib
import json
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import video_editing as E

with TemporaryDirectory() as directory:
    work=Path(directory)
    audio=work/'narration.wav'
    audio.write_bytes(b'test transcript identity')
    line='One two three four five.'
    original=work/'original.json'
    original.write_text(json.dumps({'scenes':[{'script_line':line}]}),encoding='utf-8')
    package=dict(full_voiceover_first=True,full_voiceover_file=str(audio),full_voiceover_seconds=5,
                 full_voiceover_sections=[[0,5]],original_story=str(original))
    sync=work/'voiceover_sync.json'
    mix=dict(audio=str(audio),audio_start=0,audio_end=5,video_start=0,video_end=5.3)
    sync.write_text(json.dumps([mix]),encoding='utf-8')
    cfg=dict(voiceover_mode='prepared',caption_language='auto',editing_whisper_model='base')
    words=[dict(word=word,start=i+.1,end=i+.5) for i,word in enumerate(line.split())]
    info=dict(audio=True,duration=6)
    def check(selected=cfg,segments=((0,6),),overlap=0):
        return E.prepared_caption_words(package,work,selected,segments,overlap,info)
    with patch.object(E,'run',side_effect=AssertionError('cached-only lookup must never run Whisper')):
        assert not check()
    with patch.object(E,'transcribe',return_value=words) as cached:
        assert check()==words
        assert cached.call_args.kwargs=={'cached_only':True}
        assert cached.call_args.args[2]['caption_language']=='english'
        assert not check(dict(cfg,caption_language='russian'))
        assert not check(segments=((0,2),(3,6)))
        assert check(segments=((0,5.3),(5.8,6.5)))==words
        assert not check(overlap=.1)
        sync.write_text(json.dumps([dict(mix,video_start=.2)]),encoding='utf-8')
        assert not check()
        sync.write_text(json.dumps([mix]),encoding='utf-8')
        package['full_voiceover_tracks']={'en':dict(lines=[line],sha256=hashlib.sha256(audio.read_bytes()).hexdigest())}
        assert check()==words
        audio.write_bytes(b'changed after preparation')
        assert not check()
        del package['full_voiceover_tracks']
        cached.return_value=[dict(word='unrelated',start=0,end=1)]
        assert not check()
print('PASS: cached Full Voiceover timestamps require verified source, language, beat alignment and unchanged speech timeline.')
