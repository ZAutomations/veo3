"""Parse titled story batches without turning decorative separators into films."""
import re

def parse_ideas(raw):
    lines=[s.strip() for s in str(raw or '').splitlines() if s.strip() and not re.fullmatch(r'[\s=*_\-─━—]{3,}',s.strip())]
    marker=re.compile(r'^\s*(?:#{1,6}\s*)?(?:\*\*)?STORY\s+\d+(?:\*\*)?\s*(?:[:.\-—]\s*)?(.*)$',re.I)
    starts=[(i,marker.match(s)) for i,s in enumerate(lines) if marker.match(s)]
    def block(rows,title=''):
        detail=[];preset=''
        for line in rows:
            field=re.match(r'^\s*(?:\*\*)?(title|preset)\s*:(?:\*\*)?\s*(.*)$',line,re.I)
            if field:
                if field[1].lower()=='title': title=field[2].strip()
                else: preset=field[2].strip()
            else: detail.append(line)
        if not title and detail:title=detail.pop(0).strip().strip('*').strip()
        if not title or not re.search(r'\w',title):return None
        result={'title':title}
        if detail:result['detail']='\n'.join(detail)
        if preset:result['preset']=preset
        return result
    if starts:
        result=[]
        for pos,(start,match) in enumerate(starts):
            end=starts[pos+1][0] if pos+1<len(starts) else len(lines)
            idea=block(lines[start+1:end],match[1].strip())
            if idea:result.append(idea)
        return result
    if lines and all('|' in s for s in lines):
        result=[]
        for line in lines:
            bits=[s.strip() for s in line.split('|')]
            if not bits[0]:continue
            item={'title':bits[0]}
            if len(bits)>2:
                if bits[1]:item['preset']=bits[1]
                item['detail']=' | '.join(bits[2:])
            elif len(bits)==2:item['detail']=bits[1]
            result.append(item)
        return result
    item=block(lines)
    return [item] if item else []
