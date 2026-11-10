"""Saved provider/model/voice calibration and one common story tempo."""
import hashlib
import json
import re
from pathlib import Path
import voiceover as V

MAX_RATE = 1.75

SAMPLES=[
 'Your brain collects new information throughout the day, but only some details remain. While you sleep, changing activity helps shape which memories survive and which slowly fade away by morning.',
 'Imagine opening a door and forgetting why you entered. What happened? Your attention shifted, the surroundings changed, and the thought you needed became harder to retrieve at that exact moment.',
 'Inside the human body, neurons communicate through electrical signals and chemical messengers. These microscopic processes support learning, attention, movement, and memory, while different networks continually respond to changing conditions nearby.'
]

def model(provider):
    return {'heygen':'heygen-voice-1-turbo-free','elevenlabs':'eleven_multilingual_v2','ai33pro':'provider-default-v3'}[provider]

def identity(provider,voice,seconds):
    return hashlib.sha256(json.dumps([provider,model(provider),voice,seconds,'samples-v1']).encode()).hexdigest()

def calibrate(provider,voice,seconds=10):
    import video_editing as E
    if not voice:raise ValueError('Choose a voice first.')
    seconds=int(seconds)
    if seconds not in (4,6,8,10):raise ValueError('Unsupported clip duration.')
    key=identity(provider,voice,seconds);folder=V.STORE/'calibration'/key;folder.mkdir(parents=True,exist_ok=True)
    profile=folder/'profile.json'
    if profile.is_file():
        result=json.loads(profile.read_text())
        result['usable']=result['rate']<=MAX_RATE
        result['max_rate']=MAX_RATE
        return result
    durations=[]
    for i,text in enumerate(SAMPLES):
        assert len(re.findall(r"\b[\w’'-]+\b",text))==30
        print(f'Voice calibration: sample {i+1}/3 ({provider}, {voice})...',flush=True)
        audio=V.synthesize(provider,voice,text,folder/f'sample_{i+1}.mp3')
        durations.append(V.audio_duration(audio))
    target=9.5 if seconds==10 else seconds-.15
    # Samples represent 30 words; other clip lengths scale the sample duration.
    rate=max(1.,max(durations)*(seconds/10)/(target-.02))
    result=dict(provider=provider,voice=voice,model=model(provider),seconds=seconds,target=target,rate=rate,sample_durations=durations,usable=rate<=MAX_RATE,max_rate=MAX_RATE)
    temp=profile.with_suffix('.tmp');temp.write_text(json.dumps(result,indent=2));temp.replace(profile)
    return result

def common_rate(durations,seconds,baseline=1.):
    target=9.5 if seconds==10 else seconds-.15
    # Calibration samples are advisory; only this story determines its pace.
    rate=max(1.,max(durations)/(target-.02))
    if rate>MAX_RATE:raise ValueError(f'One common pace would need {rate:.2f}x. Review the longest narration; no clip-specific speed or speech truncation was applied.')
    return rate
