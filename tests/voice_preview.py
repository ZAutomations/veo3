import sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop_app as A,voiceover as V
from fastapi import HTTPException
with tempfile.TemporaryDirectory() as tmp:
    with patch.object(V,'STORE',Path(tmp)),patch.object(V,'synthesize',side_effect=lambda provider,voice,text,target:Path(target).write_bytes(b'RIFFpreview')) as synth:
        result=A.preview_voiceover({'provider':'google','voice':'Kore','text':'My selected voice test.'})
        assert synth.call_args.args[:3]==('google','Kore','My selected voice test.')
        source=A.voiceover_preview_path(result['file']);assert source.read_bytes()==b'RIFFpreview'
        try:A.voiceover_preview_path('../private.json');raise AssertionError('Traversal accepted')
        except ValueError:pass
        try:A.preview_voiceover({'provider':'google','voice':'Kore','text':''});raise AssertionError('Empty text accepted')
        except HTTPException:pass
        target=Path(tmp)/'saved-preview.wav'
        class Window:
            def create_file_dialog(self,*args,**kwargs):return (str(target),)
        bridge=A.DesktopBridge();bridge._window=Window()
        assert bridge.save_voice_preview(result['file'],'Kore-preview.wav')==str(target)
        assert target.read_bytes()==source.read_bytes();assert synth.call_count==1
print('PASS: selected-provider preview, validation, safe audio lookup and native Save Audio copy; no live provider requests.')
