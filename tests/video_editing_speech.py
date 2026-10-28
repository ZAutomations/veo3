"""Full local speech -> silence -> transitions -> timed ASS -> MP4 smoke check."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import video_editing as e

if os.name!='nt':
    raise SystemExit('Windows offline speech fixture is unavailable on this host.')

with tempfile.TemporaryDirectory(prefix='veo-edit-speech-') as temp:
    folder=Path(temp);speech=folder/'speech.wav'
    env=os.environ.copy();env['VEO_TEST_SPEECH_PATH']=str(speech)
    command='Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile($env:VEO_TEST_SPEECH_PATH); $s.Speak("Kind words can make a home peaceful."); $s.Dispose()'
    subprocess.run(['powershell.exe','-NoProfile','-Command',command],env=env,check=True,capture_output=True,timeout=30)
    source=folder/'speech_video.mp4'
    e.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=s=270x480:r=24:d=7',
        '-i',speech,'-af','adelay=600|600,apad','-t','7','-c:v','libx264','-preset','ultrafast','-c:a','aac',source])
    (folder/'JOINED_CLIP_ORDER.txt').write_text(f'Completed video: {source}\n01 | 0.00s | one.mp4\n02 | 2.00s | two.mp4\n')
    output=e.edit(source,dict(silence_removal_enabled=True,silence_min_duration=.5,silence_padding=.15,
        editing_transitions_enabled=True,transition_zoom_in=True,transition_zoom_in_duration=.2,
        clipper_captions_enabled=True,clipper_caption_preset='hormozi_green',clipper_caption_animation='highlight',
        caption_language='english',editing_whisper_model='base',caption_position='center',caption_font_size=100))
    info=e.probe(output);assert info['audio'] and info['duration']<7
    ass=(folder/'video_editing/captions.ass').read_text(encoding='utf-8').lower()
    assert 'dialogue:' in ass and 'kind' in ass and ('peace' in ass or 'home' in ass),ass
    receipt=json.loads((folder/'video_editing/last_edit.json').read_text())
    assert 0<receipt['duration']<7 and len(receipt['transition_boundaries'])==1
    print('PASS: offline synthesized speech, real Whisper word timings, silence removal, swoosh/transition, animated ASS captions and playable final output.')
