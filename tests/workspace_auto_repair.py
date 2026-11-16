"""Offline regression check for opt-in, exact job diagnosis and duplicate repair prevention."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import json
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import desktop_app as app
import workspace_auto_repair as repair


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    job_id = 'a' * 32
    messages = []
    calls = []
    job = SimpleNamespace(id=job_id, log=messages.append, summary=lambda: {'id': job_id, 'status': 'failed'})
    assert app.repair_settings()['enabled'] in (True, False)

    def fake_codex(command, **options):
        calls.append(command)
        if command[0] == 'codex':
            assert command[command.index('--sandbox') + 1] == 'workspace-write'
            if sys.platform == 'win32':
                assert 'windows.sandbox="mxc"' in command
            assert command[command.index('--model') + 1] == 'test-model'
            report = Path(command[command.index('--output-last-message') + 1])
            assert job_id in options['input'].decode()
            report.write_text(json.dumps({'outcome': 'fixed', 'summary': 'Tested local fix.'}))
        return SimpleNamespace(returncode=0)

    with patch.object(app, 'ROOT', root), patch.object(app, 'jobs', {}), patch.object(repair.shutil, 'which', return_value='codex'), \
            patch.object(repair, 'diagnose', return_value={'jobId': job_id, 'status': 'failed'}) as diagnosis, \
            patch.object(repair.subprocess, 'run', side_effect=fake_codex):
        assert app.repair_settings() == {'enabled': False, 'model': '', 'provider': 'codex'}
        app.set_auto_repair({'enabled': True, 'model': 'test-model'})
        app.run_workspace_repair(job)
        assert not app.repair_active
        assert len(calls) == 3 and any('Auto Repair [fixed]' in line for line in messages)
        diagnosis.assert_called_once_with(root, job_id)
        app.run_workspace_repair(job)
        assert len(calls) == 3 and any('already attempted' in line for line in messages)
        assert not app.repair_active

    for provider, envelope in (
        ('gemini', {'response': '```json\n{"outcome":"external_failure","summary":"Provider outage."}\n```'}),
        ('claude', {'structured_output': {'outcome': 'external_failure', 'summary': 'Provider outage.'}}),
    ):
        current_id = ('b' if provider == 'gemini' else 'c') * 32
        def fake_provider(command, **options):
            assert command[0] == provider
            assert '--output-format' in command and current_id in options['input'].decode()
            options['stdout'].write(json.dumps(envelope).encode())
            return SimpleNamespace(returncode=0)
        with patch.object(repair, 'provider_command', return_value=[provider]), \
                patch.object(repair, 'diagnose', return_value={'jobId': current_id, 'status': 'failed'}), \
                patch.object(repair.subprocess, 'run', side_effect=fake_provider):
            repair.repair_job(root, current_id, '', messages.append, provider=provider)
        assert messages[-1] == 'Auto Repair [external_failure]: Provider outage.'

print('PASS: opt-in, exact failed job, workspace-scoped Codex run, independent verification and duplicate-run protection.')
