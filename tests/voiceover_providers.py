"""Provider dispatch/cache/task-resume contracts without network or credentials."""
import io
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import voiceover as V
with tempfile.TemporaryDirectory() as temp:
    root=Path(temp)
    with patch.object(V,'call',return_value=b'audio') as call:
        target=V.synthesize('elevenlabs','speaker','Hello',root/'eleven.mp3')
        assert call.call_args.args[1]=='/v1/text-to-speech/speaker'
        V.synthesize('elevenlabs','speaker','Hello',target)
        assert call.call_count==1,'Cached audio must not be generated again'
    target=root/'ai33.mp3';target.with_suffix('.task.json').write_text(json.dumps({'task_id':'existing-task'}))
    with patch.object(V,'call',return_value={'data':{'status':'done','metadata':{'audio_url':'https://example.test/audio'}}}) as call, patch.object(V.urllib.request,'urlopen',return_value=io.BytesIO(b'audio')):
        V.synthesize('ai33pro','speaker','Hello',target)
        assert call.call_count==1 and call.call_args.args[1]=='/v1/task/existing-task','Pending task must resume without a POST'
    import heygen_audio
    with patch.object(heygen_audio,'request',return_value={'data':{'audio_url':'https://example.test/audio'}}) as call, patch.object(V.urllib.request,'urlopen',return_value=io.BytesIO(b'audio')):
        V.synthesize('heygen','speaker','Hello',root/'heygen.mp3')
        assert call.call_args.args[0]=='/v3/models/audio/tts'
        assert call.call_args.args[1]['model']=='heygen-voice-1-turbo-free'
    target=root/'download-retry.mp3'
    with patch.object(heygen_audio,'speech',return_value={'data':{'audio_url':'https://example.test/audio'}}) as speech, patch.object(V.time,'sleep'):
        with patch.object(V.urllib.request,'urlopen',side_effect=TimeoutError('read timeout')) as download:
            try:V.synthesize('heygen','speaker','Full line',target)
            except ValueError as exc:assert 'response is saved' in str(exc)
            else:raise AssertionError('Download failure was hidden')
            assert download.call_count==3 and not target.exists()
        with patch.object(V.urllib.request,'urlopen',return_value=io.BytesIO(b'complete audio')):
            V.synthesize('heygen','speaker','Full line',target)
        assert speech.call_count==1,'Download retry must not generate again'
        assert target.read_bytes()==b'complete audio'
    target=root/'request-retry.mp3'
    with patch.object(heygen_audio,'speech',side_effect=[ValueError('request timeout'),{'data':{'audio_url':'https://example.test/audio'}}]) as speech:
        try:V.synthesize('heygen','speaker','Full line',target)
        except ValueError:pass
        with patch.object(V.urllib.request,'urlopen',return_value=io.BytesIO(b'audio')):
            V.synthesize('heygen','speaker','Full line',target)
        assert speech.call_args_list[0].kwargs['idempotency_key']==speech.call_args_list[1].kwargs['idempotency_key']
print('PASS: provider dispatch, cached-audio reuse and AI33 task resume without duplicate submission; no live requests.')
