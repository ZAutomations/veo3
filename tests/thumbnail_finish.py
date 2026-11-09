import sys
import tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import video_editing as V

with tempfile.TemporaryDirectory() as temp:
    folder=Path(temp)
    image=folder/'thumbnail_downloaded.png'
    image.write_bytes(b'\x89PNG\r\n\x1a\n'+b'x'*3000)
    for filename in ('Story.mp4','Story_edited.mp4'):
        final=folder/filename
        target=V.sync_video_thumbnail(folder/'Story raw.mp4',final)
        assert target==final.with_suffix('.png')
        assert target.read_bytes()==image.read_bytes()
    # Re-running the same result repairs a removed named copy without editing.
    (folder/'Story.png').unlink()
    assert V.sync_video_thumbnail(folder/'Story raw.mp4',folder/'Story.mp4').is_file()
print('PASS: exact final/edited thumbnail stems and repair of missing named copies; original image preserved.')
