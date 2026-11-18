"""The prepared full track must not inherit spoken audio from generated visuals."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import video_editing as E
import voiceover as V

with TemporaryDirectory() as directory:
    root=Path(directory)
    source=root/'input.mp4'
    audio=root/'narration.wav'
    package=root/'full_voiceover_story.json'
    story=dict(full_voiceover_first=True,full_voiceover_file=str(audio),scene_seconds=10,scenes=[{}])
    package.write_text(json.dumps(story),encoding='utf-8')
    cfg=dict(E.defaults(),voiceover_mode='prepared',_audio_first_story=str(package))
    def filter_graph(settings):
        with patch.object(E,'run') as run:
            V.replace_audio(source,root/'output.mp4',settings,root,aligned_speech_end=10)
        args=run.call_args.args[0]
        return args[args.index('-filter_complex')+1],args[args.index('-map')+3]
    with patch.object(E,'probe',return_value={'duration':10,'audio':True}), \
         patch.object(E,'original_end_card_start',return_value=None), \
         patch.object(E,'original_boundaries',return_value=[]), \
         patch.object(V,'audio_duration',return_value=9.0):
        graph,audio_map=filter_graph(cfg)
        assert '[0:a]' not in graph and audio_map=='[voice]'
        graph,audio_map=filter_graph(dict(cfg,full_voiceover_keep_source_audio=True))
        assert '[0:a]' in graph and audio_map=='[mixed]'
        package.write_text(json.dumps(dict(story,local_dubbing={'keep_background_gain':True})),encoding='utf-8')
        graph,audio_map=filter_graph(cfg)
        assert '[0:a]' in graph and audio_map=='[mixed]'
print('PASS: Full Voiceover First replaces raw audio by default, with explicit and verified background exceptions.')
