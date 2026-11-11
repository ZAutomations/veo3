from pathlib import Path
import tempfile,json,sys
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as D
from fastapi import HTTPException
with tempfile.TemporaryDirectory() as tmp,patch.object(D,'ROOT',Path(tmp)):
 p=Path(tmp)/'accounts.json';p.write_text(json.dumps({'current':0,'accounts':[{'label':'A','flow_credits':{'remaining':87}},{'label':'B'}]}))
 assert D.save_credit_reset_day({'label':'B','day':'31'})['day']==31
 assert D.account_list()['accounts'][1]['credits_reset_day']==31
 assert D.account_list()['accounts'][0]['flow_credits']['remaining']==87
 for value in [0,32,1.5,True,'abc']:
  try:D.save_credit_reset_day({'label':'A','day':value})
  except HTTPException as e:assert e.status_code==400
  else:raise AssertionError('Invalid reset day accepted')
 assert D.save_credit_reset_day({'label':'B','day':''})['day'] is None
 assert json.loads(p.read_text())['current']==0
print('PASS: reset day persists for inactive accounts, validates 1-31, clears explicitly and never changes balances/account selection.')
