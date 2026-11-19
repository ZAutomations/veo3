import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tempfile
from pathlib import Path
from incomplete_resume import saved_owner

def url(value,required=False): return value.strip()
with tempfile.TemporaryDirectory() as folder:
    story=Path(folder)/'story.json'; accounts=[{'label':'original','email':'Owner@example.com'}]
    assert saved_owner(story,{'account_email':'owner@example.com'},accounts,url,'project')['label']=='original'
    (Path(folder)/'incomplete project.txt').write_text('Google account (Gmail): Owner@example.com\nFlow project URL: project\n',encoding='utf-8')
    assert saved_owner(story,{},accounts,url,'project')['label']=='original'
    for state,rows,project in [({},accounts,'other'),({'account_email':'missing@example.com'},accounts,'project'),({'account_email':'Owner@example.com'},accounts*2,'project')]:
        try: saved_owner(story,state,rows,url,project)
        except ValueError: pass
        else: raise AssertionError('Unsafe owner accepted')
print('PASS: saved and legacy owners, wrong project, absent and duplicate accounts')

# Nested prepared-story markers must appear exactly once, newest first.
import json
from incomplete_resume import list_incomplete
with tempfile.TemporaryDirectory() as folder:
    base=Path(folder)
    for name,stamp in [('old',1),('new/full_voiceover/hash',2)]:
        target=base/name;target.mkdir(parents=True)
        story=target/'full_voiceover_story.json'
        story.write_text(json.dumps({'title':name,'preset':'geography-map'}),encoding='utf-8')
        (target/'incomplete project.resume.json').write_text(json.dumps({'story':str(story),'project':'project','account_email':'owner@example.com','saved_at':stamp,'phase':'download'}),encoding='utf-8')
        (target/'incomplete project.txt').write_text('Google account (Gmail): owner@example.com',encoding='utf-8')
    rows=list_incomplete(base)
    assert len(rows)==2 and rows[0]['title']=='new/full_voiceover/hash'
    assert all(row['resumable'] and row['phase']=='download' for row in rows)
print('PASS: nested incomplete discovery, no duplicate marker/state rows, newest first')

from incomplete_resume import download_and_finish
calls=[]
def plan(action,payload):
    calls.append((action,payload))
    return 'flow', [('cli',[action,payload['story']])]
payload={'story':'selected/prepared_story.json','project':'selected-project','join':True,'generationOnly':True}
lane,ops=download_and_finish(plan,payload)
assert [row[1][0] for row in ops]==['download','join']
assert all(p['story']==payload['story'] and p['project']==payload['project'] and p['generationOnly'] is False for _,p in calls)
assert payload['generationOnly'] is True
calls.clear()
_,ops=download_and_finish(plan,dict(payload,join=False))
assert len(ops)==1 and calls[0][0]=='download'
print('PASS: resume download continues to join/edit hook, preserves selected story, respects disabled join, no generation')

from incomplete_resume import complete_incomplete
with tempfile.TemporaryDirectory() as folder:
    target=Path(folder);story=target/'test_story.json'
    story.write_text(json.dumps({'title':'Test'}),encoding='utf-8')
    (target/'incomplete project.txt').write_text('Google account (Gmail): owner@example.com\nFlow project URL: project\nStory JSON: '+str(story),encoding='utf-8')
    (target/'incomplete project.resume.json').write_text(json.dumps({'story':str(story),'project':'project','status':'incomplete'}),encoding='utf-8')
    assert len(list_incomplete(target))==1
    assert not complete_incomplete(story,'different-project')
    assert len(list_incomplete(target))==1
    assert complete_incomplete(story,'project')
    assert list_incomplete(target)==[]
    assert (target/'completed project.txt').is_file()
    assert json.loads((target/'incomplete project.resume.json').read_text())['status']=='completed'
print('PASS: successful finishing hides project, wrong project preserved, history retained')
