"""Shared narrator direction; delivery instructions never become spoken text."""
import json,re
from pathlib import Path

def profile(story):
    presets=json.loads(Path(__file__).with_name('narration_tones.json').read_text(encoding='utf-8'))
    name=str(story.get('preset_id') or story.get('preset') or '').replace('_','-')
    base=presets['profiles'].get(name)
    if not base:
        if any(w in name for w in ('relationship','babyandghost','quiet-power')):base='Emotionally present, intimate and conversational; subtle tension, sincere reactions and restrained warmth. Preserve each established speaker identity and dialogue pacing.'
        elif any(w in name for w in ('space','science','technology')):base='Wonder-filled, clear science storyteller with lively curiosity, confident explanations and restrained awe.'
        elif any(w in name for w in ('wolf','crime','dark','horror','mafia')):base='Controlled suspense and quiet intrigue, crisp factual emphasis and restrained dramatic reveals; never rush or shout.'
        else:base=presets['profiles']['default']
    supplied=str(story.get('narrator_tone') or story.get('narrator_voice') or '').strip()
    scenes=[]
    for i,scene in enumerate(story.get('scenes',[])):
        tone=scene.get('narration_tone') or scene.get('voiceover_tone') or scene.get('emotional_tone') or scene.get('emotion')
        text=str(scene.get('script_line') or scene.get('external_narration') or '').casefold()
        situation=next((r['tone'] for r in presets.get('situation_rules',[]) if any(re.search(r'\b'+re.escape(w)+r'\b',text) for w in r['words'])),None)
        role='curious compelling hook' if i==0 else 'clear satisfying conclusion' if i==len(story['scenes'])-1 else 'clear engaged explanation'
        scenes.append(f'Beat {i+1}: {str(tone).strip() if tone else situation or role}.')
    return ' '.join([f'PRESET DELIVERY ({name or "custom"}): {base}',supplied[:900],
        'Keep the selected voice identity, pitch range, accent and baseline speaking pace consistent throughout. Express emotion through emphasis and intonation, not abrupt speed changes. Never start slowly and rush the ending. Dates and numbers remain clear.',
        ' '.join(scenes)])

def pace_audit(lines,sections,code='en'):
    if len(lines)<3 or len(lines)!=len(sections):return dict(checked=False,ok=True,rows=[])
    counts=[len(re.findall(r"\b[\w]+(?:[’'-][\w]+)*\b",line)) for line in lines]
    if code!='en' or min(counts)<15:return dict(checked=False,ok=True,rows=[])
    rates=[n/max(.001,b-a) for n,(a,b) in zip(counts,sections)]
    rows=[dict(beat=i+1,words=n,seconds=round(b-a,3),words_per_second=round(rate,3)) for i,(n,(a,b),rate) in enumerate(zip(counts,sections,rates))]
    spread=max(rates)/min(rates)
    # Average paragraph rates include natural pauses; allow expressive delivery
    # but reject the observed slow-opening/fast-ending failure before Flow.
    ok=spread<=1.22 and all(2.9*.85<=r<=2.9*1.15 for r in rates)
    return dict(checked=True,ok=ok,target_words_per_second=2.9,max_rate_ratio=1.22,measured_rate_ratio=round(spread,3),rows=rows)


def scene_profile(story,index):
    scenes=story.get('scenes',[])
    if not 0<=index<len(scenes):return profile(story)
    direction=profile(story)
    return direction+f' This recording contains ONLY beat {index+1}; follow its situation direction, retain the same base voice, and do not perform or say the other beats.'
