import json,pathlib,subprocess,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
from story_ideas import parse_ideas
raw='Notes before the stories\n=======================\n'+ '\n'.join(f'STORY {n}\nTITLE: Story {n}\n=======================\nStory brief:\nA relationship problem.\n\nClip 1 — Hook\nSarah: “Can we talk?”\nSAM: “Yes, I am listening.”\n\nEnding message:\nListen respectfully.\n' for n in range(1,6))
ideas=parse_ideas(raw)
assert len(ideas)==5 and [i['title'] for i in ideas]==[f'Story {n}' for n in range(1,6)]
assert '====' not in ideas[0]['detail']
assert len(parse_ideas('A title\nDetails line one\nDetails line two'))==1
assert len(parse_ideas('One | detail\nTwo | details'))==2
assert parse_ideas('====================')==[]
script="const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));const S=require('./dialogue_speakers');process.stdout.write(JSON.stringify(d.map(i=>S.labelledTranscriptTurns(i.detail))));"
turns=json.loads(subprocess.check_output(['node','-e',script],input=json.dumps(ideas),encoding='utf-8'))
assert all(t==[{'speaker':'Sarah','line':'Can we talk?'},{'speaker':'SAM','line':'Yes, I am listening.'}] for t in turns)
print('PASS: five decorated story blocks remain five; summaries/headings ignored; exact labelled dialogue preserved.')
