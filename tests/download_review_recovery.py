from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from desktop_app import blocking_review_log
silent='RECOVERY_REVIEW_REQUIRED: This is a silent story.'
verified='Verified scene IDs map each completed video asset to its story scene.'
assert 'RECOVERY_REVIEW_REQUIRED' not in blocking_review_log(silent+'\n'+verified+'\nDOWNLOAD FAILED: Scene 1: upscaled download was canceled.')
assert silent in blocking_review_log(silent)
assert silent in blocking_review_log(verified+'\n'+silent)
assert 'RECOVERY_REVIEW_REQUIRED: identity mismatch' in blocking_review_log(silent+'\n'+verified+'\nRECOVERY_REVIEW_REQUIRED: identity mismatch')
print('PASS: later verified scene IDs supersede only stale silent-order diagnostics; current identity/order errors still block retries.')
