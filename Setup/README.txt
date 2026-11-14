VEO3 PORTABLE SETUP - Windows 10/11, 64 bit

1. Copy or extract the WHOLE portable folder onto the other laptop.
   Use a normal writable folder, for example D:\Veo3. Do not run inside a ZIP.
2. Double-click Setup\INSTALL.bat (or the root SETUP.bat).
   Internet is required. Setup checks Node, Python with Tkinter, Chrome,
   FFmpeg/FFprobe, Node packages, and the Python imports needed by Studio
   and transcription (Tkinter, openpyxl, Whisper, yt-dlp, FastAPI, Uvicorn,
   pywebview and proxy_tools). Setup imports each module and loads Whisper's
   base speech model. If pip reports a package installed but its import files
   are incomplete, setup repairs Whisper or the desktop interface packages
   from PyPI without using pip's cache. Missing runtimes are downloaded and
   Python packages are installed locally. The first setup can take several
   minutes and substantial download space, especially PyTorch.
3. Double-click START_GUI.bat. In Accounts, open the automation browser
   and sign in to Google Flow. Repeat login for each account you use.

The copy includes presets, application settings, account labels, story
packages and reference images. API keys in your settings are private:
keep this personal bundle private. Browser cookies/logins are NOT copied.
Rendered videos, previous download folders, generation checkpoints,
diagnostics, Git history and installed dependencies are excluded.
Your original videos remain in the original tool folder.

Setup automatically replaces old tool-folder paths in settings/story JSON
with the new folder path. For files outside the original tool folder, use
Browse in the GUI to choose their new location. Existing Flow project URLs
still require access from the matching signed-in account.

Run CHECK.bat for a read-only dependency report. If setup fails, inspect
Setup\setup.log and run INSTALL.bat again. A failed setup is not completion.
Use START_GUI.bat so downloaded local tools and the Python environment
are available to all automation subprocesses. Do not launch the .py directly.

To move an already-installed copy again, remove .venv and tools\python
from the COPY first and rerun setup at its new location. Python environments
are tied to their installation path. Keep your stories and settings.

Build another clean copy from the main tool:
  python Setup\build_portable.py
The builder creates a sibling folder and ZIP; it does not alter your stories.


Studio app icon and desktop shortcut
-----------------------------------
Successful setup automatically creates/updates START_STUDIO.lnk on the current
Windows user's Desktop, pointing to this installation's START_STUDIO.bat.
The bundled desktop_ui/studio.ico is used for the shortcut and Studio window;
desktop_ui/studio-icon.png is the matching PNG asset. Both assets are included
in the repository and portable package, so no image generation is needed on a
new PC. Existing shortcut targets are rebound to the current installed folder.
To restore just the shortcut/icon after relocating an installation, run:
  powershell -NoProfile -ExecutionPolicy Bypass -File Setup\SET_STUDIO_ICON.ps1 -UpdateTarget

Desktop icon after updates
START_STUDIO.bat now checks the desktop START_STUDIO shortcut automatically.
After a clone, git pull, or moving the tool folder, start Studio once to create
or repair its shortcut using the included desktop_ui/studio.ico. A correct
shortcut is left unchanged. Manual repair: powershell -NoProfile -ExecutionPolicy
Bypass -File Setup\SET_STUDIO_ICON.ps1 -UpdateTarget
Google service-account JSON files remain local and must be copied separately.
