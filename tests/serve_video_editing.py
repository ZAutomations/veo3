"""Isolated local server for the Video Editing UI integration check."""
import pathlib
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import desktop_app as app
import video_editing

if __name__=='__main__':
    folder=pathlib.Path(sys.argv[2]);folder.mkdir(exist_ok=True)
    app.STATE=folder/'desktop_settings.json'
    app.WRITER_STATE=folder/'writer_settings.json'
    app.save_json(app.STATE,dict(current='editing',theme='matte'))
    video_editing.SETTINGS=folder/'video_editing_settings.json'
    import uvicorn
    uvicorn.run(app.app,host='127.0.0.1',port=int(sys.argv[1]),log_level='warning')
