import sys,json,tempfile
from pathlib import Path
from unittest.mock import patch
from fastapi import HTTPException
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as D
with tempfile.TemporaryDirectory() as tmp,patch.object(D,'ROOT',Path(tmp)):
    file=Path(tmp)/'accounts.json'
    original={'current':0,'browser':'Active','accounts':[
        {'label':'Active','profile':'active','email':'active@gmail.com','flow_credits':{'remaining':928}},
        {'label':'Other','profile':'other','email':'Other','clips_used':7,'max_clips':100,'credits_reset_day':17,'flow_credits':{'remaining':100}}]}
    file.write_text(json.dumps(original))
    assert D.save_account_email({'label':'Other','email':'  UPDATED@GMAIL.COM '})['email']=='updated@gmail.com'
    saved=json.loads(file.read_text());other=saved['accounts'][1]
    assert saved['current']==0 and saved['browser']=='Active'
    assert saved['accounts'][0]==original['accounts'][0]
    assert other['profile']=='other' and other['clips_used']==7 and other['credits_reset_day']==17
    assert 'flow_credits' not in other
    saved['accounts'][1]['flow_credits']={'remaining':87};file.write_text(json.dumps(saved))
    D.save_account_email({'label':'Other','email':'updated@gmail.com'})
    assert json.loads(file.read_text())['accounts'][1]['flow_credits']['remaining']==87,'unchanged email must keep valid balance'
    before=file.read_text()
    for email in ('username','bad@@gmail.com','name @gmail.com','','a@b'):
        try:D.save_account_email({'label':'Other','email':email})
        except HTTPException as e:assert e.status_code==400
        else:raise AssertionError('Invalid email accepted')
    try:D.save_account_email({'label':'Missing','email':'valid@gmail.com'})
    except HTTPException as e:assert e.status_code==404
    else:raise AssertionError('Unknown account accepted')
    assert file.read_text()==before
print('PASS: edit inactive account email; normalize/validate; preserve browser, profiles, order and counters; invalidate only the changed identity balance; invalid input cannot mutate accounts.')
