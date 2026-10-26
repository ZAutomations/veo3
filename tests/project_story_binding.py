import sys,tempfile,json,hashlib,subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as app
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp)
    files=[]
    for name,count in [('ship',8),('phone',10)]:
        folder=root/name;folder.mkdir();file=folder/(name+'_story.json');file.write_text(json.dumps({'title':name,'scenes':[{}]*count}));files.append(file)
    ship,phone=files
    checkpoint=ship.parent/'agent_batches_project123.json'
    checkpoint.write_text(json.dumps({'project':'project123','fingerprint':hashlib.sha256(ship.read_bytes()).hexdigest()}))
    project='https://flow.google.com/project/project123'
    app.validate_download_project(ship,project)
    try:app.validate_download_project(phone,project)
    except ValueError as e:assert 'ship' in str(e) and '8 clips' in str(e)
    else:raise AssertionError('Different story/project combination must be rejected')
    script="const B=require('./project_story_binding');B.assertBinding(process.argv[1],process.argv[2]);"
    good=subprocess.run(['node','-e',script,project,str(ship)],cwd=app.ROOT,capture_output=True,text=True)
    bad=subprocess.run(['node','-e',script,project,str(phone)],cwd=app.ROOT,capture_output=True,text=True)
    assert good.returncode==0 and bad.returncode!=0 and 'STORY_PROJECT_MISMATCH' in bad.stderr
    assert str(ship) in bad.stderr
    # Unverified/stale checkpoints cannot claim another story's project.
    checkpoint.write_text(json.dumps({'project':'project123','fingerprint':'wrong'}))
    app.validate_download_project(phone,project)
print('PASS: Studio and CLI reject verified story/project mismatches with the correct story title/path; matching and unverified projects are unaffected.')
