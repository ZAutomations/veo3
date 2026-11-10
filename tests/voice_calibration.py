import json
from pathlib import Path
import re
import sys
import tempfile
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import voice_calibration as C
assert all(len(re.findall(r"\b[\w’'-]+\b",s))==30 for s in C.SAMPLES)
with tempfile.TemporaryDirectory() as tmp, patch.object(C.V,'STORE',Path(tmp)), patch.object(C.V,'synthesize',side_effect=lambda provider,voice,text,target:target) as synth, patch.object(C.V,'audio_duration',side_effect=[10.,11.,12.]):
    profile=C.calibrate('heygen','voice-one',10)
    assert profile['target']==9.5 and abs(profile['rate']-12/9.48)<1e-9
    assert synth.call_count==3
    assert C.calibrate('heygen','voice-one',10)==profile and synth.call_count==3
    assert C.identity('heygen','voice-one',10)!=C.identity('heygen','voice-two',10)
    assert C.common_rate([9.,13.],10,profile['rate'])>profile['rate']
    try:C.common_rate([18.],10)
    except ValueError:pass
    else:raise AssertionError('Excessive common speed must stop')
assert abs(C.common_rate([15.640794],10,1.6498727848101264)-1.6498727848101264)<1e-9
print('PASS: exactly 30-word samples, voice/model-specific saved profile, no duplicate calibration calls, common story pace and excessive-speed refusal.')

assert C.common_rate([9.,9.4],10,1.65)==1., 'Calibration must not accelerate already fitting narration'
assert 1.19<C.common_rate([9.679792,10.960229,11.34,10.016479,10.736292,10.271896],10,1.65)<1.20
