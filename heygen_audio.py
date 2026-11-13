"""HeyGen narration preview. Credentials and generated previews stay outside Git."""
import json
import os
from pathlib import Path
import urllib.request
import urllib.error
import uuid

STORE = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Veo3Studio' / 'heygen'

class HeyGenNetworkError(RuntimeError):
    """Recoverable transport/service failure; retry must retain request identity."""


def configure(key):
    key = str(key or '').strip()
    if key:
        STORE.mkdir(parents=True, exist_ok=True)
        (STORE / 'credentials.json').write_text(json.dumps({'api_key': key}), encoding='utf-8')

def api_key():
    key = os.environ.get('HEYGEN_API_KEY', '').strip()
    if not key:
        try:
            key = json.loads((STORE / 'credentials.json').read_text(encoding='utf-8'))['api_key']
        except (OSError, ValueError, KeyError):
            pass
    if not key:
        raise ValueError('Save your HeyGen API key first.')
    return key

def request(route, payload=None, idempotency_key=None):
    key = api_key()
    headers = {'X-Api-Key': key, 'Content-Type': 'application/json'}
    if payload is not None:
        headers['Idempotency-Key'] = idempotency_key or str(uuid.uuid4())
    req = urllib.request.Request('https://api.heygen.com' + route,
        data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 402:
            raise ValueError('HeyGen API credits are insufficient. Check API billing in your HeyGen account; voice preview was not generated.') from None
        message = exc.read().decode(errors='replace').replace(key, '[hidden]')[:600]
        error = HeyGenNetworkError if exc.code in (408, 429, 500, 502, 503, 504) else ValueError
        raise error(f'HeyGen HTTP {exc.code}: {message}') from None
    except OSError as exc:
        raise HeyGenNetworkError('HeyGen request failed: ' + str(exc).replace(key, '[hidden]')) from None
    except ValueError:
        raise ValueError('HeyGen returned an invalid JSON response; review the provider response.') from None

def voices():
    result = request('/v3/voices?limit=100&language=en')
    data = result.get('data', [])
    return data if isinstance(data, list) else data.get('voices', [])

def speech(voice_id, text, idempotency_key=None):
    return request('/v3/models/audio/tts', {
        'model': 'heygen-voice-1-turbo-free',
        'voice_id': voice_id, 'text': text,
    }, idempotency_key=idempotency_key)

def preview(voice_id, text):
    text = str(text or '').strip()
    if not voice_id or not 1 <= len(text) <= 500:
        raise ValueError('Choose a voice and enter 1–500 characters for the preview.')
    result = speech(voice_id, text)
    data = result.get('data') or {}
    url = data.get('audio_url')
    if not isinstance(url, str) or not url.startswith('https://'):
        raise ValueError('HeyGen did not return an audio URL: ' + str(result)[:500])
    STORE.mkdir(parents=True, exist_ok=True)
    target = STORE / (uuid.uuid4().hex + '.wav')
    # Audio download uses no API credential header.
    with urllib.request.urlopen(url, timeout=120) as response:
        audio = response.read(20 * 1024 * 1024)
    if not audio:
        raise ValueError('HeyGen returned an empty audio file.')
    target.write_bytes(audio)
    return {'file': target.name, 'duration': data.get('duration')}
