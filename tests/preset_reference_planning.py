import json
import pathlib
import sys
import tempfile
import types

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import desktop_app as app

with tempfile.TemporaryDirectory() as folder:
    story = pathlib.Path(folder) / 'sample_story.json'
    story.write_text(json.dumps({'title':'Sample', 'preset_id':'relationship-dialogue-real',
        'scene_seconds':8, 'scenes':[{'veo3_prompt':'Sample'}]}))
    for mode in ('agent', 'ingredients', 'omni'):
        payload = dict(view=mode, story=str(story), project='https://flow.google.com/project/sample',
            model='Veo 3.1 - Lite' if mode == 'ingredients' else 'Omni 1.1 Flash',
            aspect='9:16', seconds=8, resolution='360p', reuseRefs=True,
            genRefs=False, usePresetRefs=True, download=False)
        _, ops = app.plan_action('generate', payload)
        if mode == 'omni':
            assert ops[0][1][1]['genRefs'] and not ops[0][1][1]['reuseRefs']
        elif mode == 'ingredients':
            assert '--gen-refs' in ops[0][1] and '--skip-refs' not in ops[0][1]
        else:
            assert any(pathlib.Path(spec[1]).name == 'generate_refs.js' for kind, spec in ops if kind == 'cli')
        for enabled in (True,False):
            fake = types.SimpleNamespace(payload=dict(payload,usePresetRefs=enabled))
            env=app.Job.reference_environment(fake)
            assert env['VEO_PRESET_REFS'] == ('1' if enabled else '0')
    _, queue=app.plan_action('generate_queue',dict(payload,view='agent',queue=[str(story)],newProject=True))
    assert queue[0][1][1]['generate_refs']
print('PASS: library preparation in Agent/Ingredients/Omni, queue propagation and isolated per-job on/off environment.')
