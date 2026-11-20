"""English narration replacement using verified local visuals, never Veo."""
import copy,hashlib,json,sys
from pathlib import Path
import video_editing as E
import voiceover as V
import full_voiceover as F
from local_dubbing import media_for,timeline
from story_output import safe_story_title

def plan(body):
    folder=Path(body.get('folder','')).expanduser().resolve()
    if not body.get('folder') or not folder.is_dir():raise ValueError('Choose one existing story folder.')
    files=list(folder.glob('*_story.json'))
    if len(files)!=1:raise ValueError('Choose the main story folder containing exactly one original story JSON.')
    story=json.loads(files[0].read_text(encoding='utf-8-sig'))
    if story.get('narrated') is False or any(s.get('dialogue') for s in story['scenes']):raise ValueError('English repair currently supports single-narrator stories only.')
    lines=[str(s.get('external_narration') or s.get('script_line') or '').strip() for s in story['scenes']]
    if not all(lines):raise ValueError('Every scene needs the complete approved English narration.')
    media=media_for(files[0],story,native_only=True)
    if not media:raise ValueError('A joined raw video and verified JOINED_CLIP_ORDER.txt are required. Join the verified clips first.')
    raw,_,report,_=media;sections,info=timeline(raw,report,len(lines))
    cfg=E.settings(body.get('editingSettings'));provider=body.get('provider') or cfg['voiceover_provider'];voice=body.get('voice') or cfg['voiceover_voice']
    if provider not in ('google','elevenlabs','heygen') or not str(voice).strip():raise ValueError('Select a supported TTS provider and voice.')
    return dict(story=str(files[0]),raw=str(raw),report=str(report),lines=lines,sections=sections,provider=provider,voice=voice,settings=cfg)

def run(body):
    p=plan(body);source=Path(p['story']);story=json.loads(source.read_text(encoding='utf-8-sig'))
    key=hashlib.sha256(json.dumps([p['lines'],p['provider'],p['voice']],ensure_ascii=False).encode()).hexdigest()[:16]
    work=source.parent/'english_voiceover_repair'/key;work.mkdir(parents=True,exist_ok=True)
    track,words=F.record_language(work,p['settings'],'en',dict(provider=p['provider'],voice=p['voice']),p['lines'])
    package=copy.deepcopy(story);package.pop('multilingual',None)
    package.update(audio_first=True,full_voiceover_first=True,original_story=str(source),full_voiceover_file=track['file'],full_voiceover_seconds=track['seconds'],full_voiceover_sections=track['sections'],full_voiceover_visual_sections=p['sections'])
    prepared=work/'repaired_story.json';prepared.write_text(json.dumps(package,ensure_ascii=False,indent=2),encoding='utf-8')
    cfg=dict(p['settings'],full_voiceover_keep_source_audio=False,preset_cta_enabled=False)
    output=source.parent/(safe_story_title(story['title'])+' English Repaired.mp4')
    E.edit(p['raw'],cfg,report=p['report'],output=output,story_file=prepared)
    print('ENGLISH_REPAIR_OUTPUT: '+str(output),flush=True)
    return output

if __name__=='__main__':
    try:run(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig')))
    except Exception as exc:print('RECOVERY_REVIEW_REQUIRED: ENGLISH REPAIR FAILED: '+str(exc),flush=True);sys.exit(2)
