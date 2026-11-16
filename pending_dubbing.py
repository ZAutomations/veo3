"""Discover and finish missing language exports from completed English projects."""
from pathlib import Path
import hashlib
import json
import re

import multilingual as M
import video_editing as E
from story_output import safe_story_title, story_video_path


def supplied_languages(story):
    scenes = story.get('scenes', [])
    if not scenes:
        return []
    def supplied(scene, code):
        if scene.get('dialogue_translations'):
            return bool(scene['dialogue_translations'].get(code))
        return bool(str(scene.get('narration_translations', {}).get(code, '')).strip())
    return [code for code in M.LANGUAGES if all(supplied(scene, code) for scene in scenes)]


def playable(file):
    try:
        if file.is_file():
            info = E.probe(file)
            return info['duration'] > 0 and info['audio']
    except (ValueError, OSError, RuntimeError):
        pass
    return False


def matched_report(video, report):
    if not video.is_file() or not report.is_file():
        return False
    line = re.search(r'^Completed video:\s*(.+?)\s*$', report.read_text(encoding='utf-8-sig'), re.M)
    return bool(line and Path(line[1]).resolve() == video.resolve())


def full_tracks(file, story):
    from local_dubbing import read
    tracks = story.get('full_voiceover_tracks')
    if tracks:
        return tracks
    review = file.parent / 'FULL_VOICEOVER_REVIEW.json'
    return read(review).get('languages', {}) if review.is_file() else {}


def source_package(source, original):
    from local_dubbing import english, read
    english_lines = [english(scene) for scene in original['scenes']]
    candidates = [*source.parent.glob('full_voiceover/*/full_voiceover_story.json'),
                  *source.parent.glob('audio_first/*/*_story.json')]
    for file in sorted(candidates, key=lambda p: p.stat().st_mtime_ns, reverse=True):
        try:
            data = read(file)
            if not data.get('audio_first') or Path(data.get('original_story', '')).resolve() != source:
                continue
            if data.get('full_voiceover_first'):
                lines = full_tracks(file, data).get('en', {}).get('lines', [])
            else:
                lines = [english(scene) for scene in data['scenes']]
            if lines != english_lines:
                continue
            final = story_video_path(file)
            raw = final.with_name(final.stem + ' raw.mp4')
            report = file.parent / 'JOINED_CLIP_ORDER.txt'
            if matched_report(raw, report) and playable(final):
                return file, raw, report, data
        except (ValueError, OSError, KeyError, TypeError):
            continue
    return None


def plan_pending(body):
    from local_dubbing import SKIP, read, timeline
    folder = Path(body.get('folder', '')).expanduser().resolve()
    if not str(body.get('folder', '')).strip() or not folder.is_dir():
        raise ValueError('Choose the stories folder or one completed story folder.')
    settings = M.configuration(body.get('multilingual'))
    voices = {row['code']:row for row in settings['languages']}
    jobs = []
    for source in sorted(folder.rglob('*_story.json')):
        if any(p in SKIP or p in ('full_voiceover', '_reverse_engineering') for p in source.relative_to(folder).parts[:-1]):
            continue
        try:
            original = read(source)
            if not isinstance(original, dict) or original.get('audio_first') or not original.get('title'):
                continue
            codes = supplied_languages(original)
            if not codes or not playable(story_video_path(source)):
                continue
            title = safe_story_title(original['title'])
            missing = [code for code in codes if not playable(source.parent / f'{title} {M.LANGUAGES[code]}.mp4')]
            if not missing:
                continue
            package = source_package(source.resolve(), original)
            if package:
                file, raw, report, data = package
                if data.get('deferred_dubbing') is not None:
                    missing = [code for code in missing if code in data['deferred_dubbing']]
                rows, _ = timeline(raw, report, len(data['scenes']))
            else:
                # Native English projects use their verified joined timeline and speech separation.
                file, raw, report = None, source.parent / (title+' raw.mp4'), source.parent / 'JOINED_CLIP_ORDER.txt'
                if not matched_report(raw, report):
                    continue
                rows, _ = timeline(raw, report, len(original['scenes']))
            if missing:
                jobs.append(dict(title=original['title'], video=str(raw), timeline=rows, clean_background=bool(package),
                                 original_story=str(source), package=str(file) if file else '', pending=missing,
                                 profiles=[voices[code] for code in missing if code in voices],
                                 missing_voices=[code for code in missing if code not in voices]))
        except (ValueError, OSError, RuntimeError, KeyError, TypeError):
            continue
    return dict(folder=str(folder), multilingual=settings, jobs=jobs)


def render_prepared(job, profile, body):
    from full_voiceover import record_language
    from local_dubbing import read
    file = Path(job['package'])
    story = read(file)
    original = read(job['original_story'])
    code = profile['code']
    request = dict(story=str(file), multilingual=dict(enabled=True, languages=[profile]), editingSettings=body.get('editingSettings'))
    story['multilingual_translation_mode'] = 'supplied_only'
    if story.get('full_voiceover_first'):
        tracks = full_tracks(file, story)
        existing = tracks.get(code)
        if not existing or existing.get('profile') != profile or not Path(existing.get('file', '')).is_file():
            lines = [scene['narration_translations'][code] for scene in original['scenes']]
            key = hashlib.sha256(json.dumps([profile, lines], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]
            tracks[code], _ = record_language(file.parent / 'deferred_audio' / code / key,
                                               E.settings(body.get('editingSettings')), code, profile, lines)
        story['full_voiceover_tracks'] = tracks
        story.setdefault('full_voiceover_visual_sections',story['full_voiceover_sections'])
    else:
        for prepared, original_scene in zip(story['scenes'], original['scenes'], strict=True):
            prepared.setdefault('narration_translations', {})[code] = original_scene['narration_translations'][code]
    return M.render(request, prepared_story=story)
