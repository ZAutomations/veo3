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

def number_syllables(value):
    # Approximate spoken load, not the number of printed digit tokens. Years
    # such as 2026 are normally read as "twenty twenty six".
    small=(1,1,1,1,1,1,1,2,1,1,1,3,1,2,2,2,2,3,2,2)
    tens=(0,0,2,2,2,2,2,3,2,2)
    def cardinal(n):
        if n<20:return small[n]
        if n<100:return tens[n//10]+(small[n%10] if n%10 else 0)
        if n<1000:return small[n//100]+2+(1+cardinal(n%100) if n%100 else 0)
        for scale,load in ((10**12,2),(10**9,2),(10**6,2),(1000,2)):
            if n>=scale:return cardinal(n//scale)+load+(cardinal(n%scale) if n%scale else 0)
    text=re.sub(r'(?:st|nd|rd|th)$','',value.lower()).replace(',','')
    if '.' in text:
        integer,fraction=text.split('.',1)
        return cardinal(int(integer))+1+sum(small[int(d)] for d in fraction)
    n=int(text)
    if 1900<=n<=2099 and n%100:
        return cardinal(n//100)+cardinal(n%100)
    return cardinal(n)


def spoken_load(line):
    total=0
    for word in re.findall(r"[a-z]+(?:[’'-][a-z]+)*|[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?(?:st|nd|rd|th)?",line.lower()):
        if word[0].isdigit():
            total+=number_syllables(word)
            continue
        for part in re.split("[’'-]",word):
            groups=len(re.findall('[aeiouy]+',part))
            groups-=int(part.endswith('e') and not part.endswith(('le','ye')))
            total+=max(1,groups)
    return total


def pace_audit(lines,sections,code='en'):
    if len(lines)<3 or len(lines)!=len(sections):return dict(checked=False,ok=True,rows=[])
    counts=[len(re.findall(r"\b[\w]+(?:[’'-][\w]+)*\b",line)) for line in lines]
    if code!='en' or min(counts)<15:return dict(checked=False,ok=True,rows=[])
    durations=[b-a for a,b in sections]
    if any(d<=0 for d in durations):raise ValueError('Invalid paragraph pace timing.')
    rates=[n/d for n,d in zip(counts,durations)]
    loads=[spoken_load(line) for line in lines]
    delivery_rates=[n/d for n,d in zip(loads,durations)]
    rows=[dict(beat=i+1,words=n,seconds=round(d,3),words_per_second=round(rate,3),
               estimated_spoken_syllables=load,estimated_syllables_per_second=round(spoken,3))
          for i,(n,d,rate,load,spoken) in enumerate(zip(counts,durations,rates,loads,delivery_rates))]
    word_spread=max(rates)/min(rates)
    spread=max(delivery_rates)/min(delivery_rates)
    # Printed word counts are editorial budgets, not acoustic duration. Dates,
    # polysyllabic terms and normal expressive pauses must not be classified as
    # an invalid recording merely because they take longer than short words.
    # This is a delivery heuristic; transcript/coverage integrity is checked
    # separately by timed_sections and the measured-duration gate.
    ok=spread<=1.35 and all(1.5<=r<=4.5 for r in rates)
    return dict(checked=True,ok=ok,method='speech_load_v2',target_words_per_second=2.9,
                max_rate_ratio=1.35,measured_rate_ratio=round(spread,3),
                printed_word_rate_ratio=round(word_spread,3),rows=rows)



def scene_profile(story,index):
    scenes=story.get('scenes',[])
    if not 0<=index<len(scenes):return profile(story)
    direction=profile(story)
    return direction+f' This recording contains ONLY beat {index+1}; follow its situation direction, retain the same base voice, and do not perform or say the other beats.'
