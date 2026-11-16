"""Recover only the failed Full Voiceover First language from a saved Studio job."""
from pathlib import Path
import hashlib
import json
import os
import re

import full_voiceover as F
import multilingual as M
import video_editing as E
import voiceover as V


def digest(audio, language, lines):
    identity = hashlib.sha256(json.dumps([language, lines], ensure_ascii=False).encode())
    with audio.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            identity.update(block)
    return identity.hexdigest()


def load_verified_track(folder, language, lines):
    receipt = folder / 'ALIGNMENT_RECOVERY.json'
    if not receipt.is_file():
        return None
    try:
        data = json.loads(receipt.read_text(encoding='utf-8'))
        name = data['audio']
        if name not in ('narration.wav', 'recovered_narration.wav'):
            return None
        audio = folder / name
        if data['identity'] != digest(audio, language, lines):
            return None
        duration = V.audio_duration(audio)
        sections = F.timed_sections(lines, data['words'], duration, language, data['corroborating'])
        return audio, duration, sections, data['words']
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        return None


def alternate_decode(audio, folder, language):
    model = Path(os.environ.get('XDG_CACHE_HOME', Path.home() / '.cache')) / 'whisper' / 'small.pt'
    if not model.is_file():
        raise ValueError('The local Whisper small weights are unavailable for independent verification.')
    identity = digest(audio, language, ['independent-whisper-small-v1'])[:16]
    output = folder / f'alignment_probe_{identity}.json'
    if not output.is_file():
        E.run([E.whisper_python(), E.ROOT / 'voiceover_alignment_probe.py', audio, language, model, output], timeout=480)
    return json.loads(output.read_text(encoding='utf-8'))


def confirmed_omission(lines, primary, alternate, language):
    """Both reads must omit the same words immediately between matching timed anchors."""
    reference = [token for line in lines for token in F.tokens(line, language)]
    first, exact_first, edits_first = F.match_words(reference, primary, language)
    second, exact_second, edits_second = F.match_words(reference, alternate, language)
    other_deletions = {(a, b) for kind, a, b, _, _ in edits_second if kind == 'delete'}
    anchors = exact_first & exact_second
    for kind, a, b, _, _ in edits_first:
        if kind != 'delete' or b-a < 2 or (a, b) not in other_deletions or not {a-1, b} <= anchors:
            continue
        if any(abs(first[i][1]-second[i][1]) > .3 for i in (a-1, b)):
            continue
        if all(-.02 <= result[b][1]-result[a-1][2] <= .12 for result in (first, second)):
            return True
    return False


def verify_and_save(audio, folder, language, lines, primary, corroborating=()):
    F.timed_sections(lines, primary, V.audio_duration(audio), language, corroborating)
    M.atomic(folder / 'ALIGNMENT_RECOVERY.json', dict(audio=audio.name, identity=digest(audio, language, lines),
                                                     words=primary, corroborating=corroborating))


def repair_failed_track(root, evidence, log):
    errors = '\n'.join(evidence.get('latestErrors', []))
    match = re.search(r'FULL VOICEOVER FIRST FAILED: Full narration transcript \(([a-z]{2})\)', errors)
    if not match or not evidence.get('view'):
        return None
    language = match[1]
    if language != 'en' and language not in M.LANGUAGES:
        return None
    if evidence['view'] not in ('writer', 'agent', 'ingredients', 'omni', 'reverse', 'manual'):
        return None
    checkpoint = root / 'logs' / 'desktop' / f"last_{evidence['view']}_job.json"
    record = json.loads(checkpoint.read_text(encoding='utf-8-sig'))
    if record.get('status') != 'failed' or record.get('id') != evidence['jobId']:
        return None
    kind, request = record['operations'][record['operation_index']]
    if kind != 'request' or request[0] != 'full_voiceover.py':
        return None
    if not Path(request[1]['story']).resolve().is_relative_to(root / 'stories'):
        return None
    planned = F.plan_package(request[1])
    cfg = planned['cfg']
    folder = planned['folder']
    label = 'English' if language == 'en' else M.LANGUAGES[language]
    if language == 'en':
        profile = dict(provider=cfg['voiceover_provider'], voice=cfg['voiceover_voice']) if cfg['voiceover_mode']=='api' else None
        lines = planned['lines']
    else:
        profile = next(row for row in planned['multilingual']['languages'] if row['code']==language)
        folder = planned['language_folder']
        lines = json.loads((folder / f'{language}_source_lines.json').read_text(encoding='utf-8'))
        lines = [scene.get('narration_translations', {}).get(language, '').strip() or line
                 for scene, line in zip(planned['original']['scenes'], lines, strict=True)]
        folder = folder / 'languages' / language
    audio = folder / 'narration.wav'
    if load_verified_track(folder, language, lines):
        return dict(outcome='fixed', summary=f'{label} already has verified recovery timestamps. Use Retry / Continue.')
    log(f'Auto Repair: independently checking the cached {label} recording before considering regeneration.')
    settings = dict(cfg, editing_whisper_model='small', caption_language=label.lower())
    primary = E.transcribe(audio, folder, settings)
    alternate = alternate_decode(audio, folder, language)
    for words, corroborating in ((alternate, ()), (primary, (alternate,))):
        try:
            verify_and_save(audio, folder, language, lines, words, corroborating)
            return dict(outcome='fixed', summary=f'{label} timestamps passed the existing alignment check. The original recording is preserved. Use Retry / Continue.')
        except F.NarrationAlignmentError:
            continue
    if not profile or not confirmed_omission(lines, primary, alternate, language):
        return dict(outcome='needs_input', summary=f'{label} still falls short after an independent transcription pass. The two reads did not corroborate a clear omission that warrants regenerating the recording. Review the cached audio against the approved script.')

    log(f'Auto Repair: two transcription passes found the same missing {label} phrase. Testing one replacement recording for this language only.')
    target = planned['english_target'] if language == 'en' else None
    raw = F.synthesize_full_track(profile, lines, folder / 'alignment_repair.source.mp3', language, label, target)
    candidate = folder / 'recovered_narration.wav'
    if not candidate.is_file():
        E.run(['ffmpeg','-v','error','-y','-i',raw,'-ar','48000','-ac','1',candidate])
    if target is not None and V.audio_duration(candidate)>target+planned['seconds']:
        return dict(outcome='needs_input', summary='The replacement English recording exceeds the visual clip limit. The original was preserved.')
    words = alternate_decode(candidate, folder, language)
    try:
        verify_and_save(candidate, folder, language, lines, words)
    except F.NarrationAlignmentError as error:
        return dict(outcome='needs_input', summary=f'The replacement {label} recording did not pass alignment. The original was preserved. {error}')
    return dict(outcome='fixed', summary=f'One verified {label} replacement is ready. The original and the other tracks are preserved. Use Retry / Continue.')
