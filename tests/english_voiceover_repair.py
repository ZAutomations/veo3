import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from unittest.mock import patch
import english_voiceover_repair as R
folder=Path('stories/genai_dark_conspiracy/the_secret_city_built_for_the_atomic_bomb_ready_ac799b4e2c').resolve()
with patch.object(R.V,'synthesize',side_effect=AssertionError('Preflight must never call paid TTS')):
 p=R.plan(dict(folder=str(folder),provider='google',voice='Orus'))
 assert len(p['lines'])==6 and len(p['sections'])==6
 assert p['provider']=='google' and p['voice']=='Orus'
 assert Path(p['raw']).name.endswith(' raw.mp4')
 assert p['lines'][-1].endswith('consequences.')
try:R.plan({'folder':''})
except ValueError:pass
else:raise AssertionError('Empty folder accepted')
print('PASS: English repair preflight validates all six complete lines and raw scene mapping without TTS or Veo calls')
