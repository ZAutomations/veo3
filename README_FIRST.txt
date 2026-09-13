================================================================
 VEO3 FLOW AUTOMATION  -  PORTABLE COPY
 Read this once, then you never need it again.
================================================================

This folder is self-contained. Copy the whole thing to the new PC
(USB stick, external drive, network share, cloud drive - any of
them work), then follow the four steps below.

Nothing in here needs the old PC.


----------------------------------------------------------------
 THE FOUR STEPS
----------------------------------------------------------------

1. COPY this whole folder to the new PC.
   Put it somewhere simple, for example:
       D:\Veo3_New
   Avoid OneDrive / Desktop / any path with a very long name.
   The total is about 440 MB.

2. RUN  SETUP.bat   (double-click it).

   It checks for the four things the tool needs and installs
   whatever is missing:
       - Node.js 18+          (runs the automation)
       - Python 3 + tkinter   (runs the desktop tool)
       - Google Chrome        (the browser it drives)
       - puppeteer            (npm install - the slow part)

   If it says "CLOSE this window and run SETUP.bat again", do
   that. Windows only makes a freshly installed program visible
   in a NEW window, so the second run is normal and expected.

3. RUN  START_GUI.bat   (double-click it).
   The tool opens.

4. THE FIRST RUN opens an automation Chrome window.
   If it asks you to sign in to Google, sign in once with the
   account that has Flow access. It is remembered after that.


----------------------------------------------------------------
 ONE THING THAT DOES NOT TRAVEL
----------------------------------------------------------------

Your Google sign-in does NOT come across in this folder.

The automation uses its own Chrome profile, kept in
    C:\Users\<you>\AppData\Local\flow-mcp-profile
That is outside this folder, and it is where the Flow login
lives. On the new PC the tool builds a fresh one, so you sign in
to Flow once, by hand, in the window it opens.

That is the only manual step. Everything else carries over.


----------------------------------------------------------------
 WHAT IS IN HERE
----------------------------------------------------------------

  the code            *.js   the automation and the story writer
                      *.py   the desktop tool
  styles.json         26 genre presets for story generation
  gui_settings.json   YOUR SETTINGS - see the warning below
  stories/            every story you have made: the story JSON,
                      the agent prompt, the style bible, the
                      character reference sheets, and the rendered
                      clips (about 380 MB of the 440)
  Veo3_Portable...    this read-me and SETUP.bat
  .git/               the version history, if you want it


----------------------------------------------------------------
 KEEP gui_settings.json PRIVATE
----------------------------------------------------------------

gui_settings.json holds your Gemini API keys and your Flow
project links. It is in here because otherwise the tool would
start up blank on the new PC - but do not email it, do not put
it in a public repo, and do not paste it into a chat.

If you would rather move the folder without the keys, open
gui_settings.json in Notepad first and clear these two lines:
    "gemini_api_key"   ->  ""
    "gemini_api_keys"  ->  []
Then type the keys into the tool on the new PC instead.


----------------------------------------------------------------
 TWO SMALL THINGS TO KNOW
----------------------------------------------------------------

- The tool remembers the last story you had open by its FULL
  path. If you put the folder somewhere other than where it was,
  that path is stale. Just pick the story again with the Browse
  button - it takes a second, and the tool sorts out the rest.

- Chrome can be in any of the standard places (Program Files,
  Program Files (x86), or your per-user AppData). The tool finds
  it automatically. SETUP.bat installs it if none of them has it.


----------------------------------------------------------------
 WHAT WAS LEFT OUT, AND WHY
----------------------------------------------------------------

  node_modules/   Not copied on purpose. It holds puppeteer plus
                  a downloaded copy of Chrome for Testing, and
                  those are built for one specific machine. Copying
                  them would produce a folder that looks complete
                  and fails to start. SETUP.bat rebuilds it.

  logs/           Run logs from the old machine. No value on the
                  new one, and the tool writes fresh ones.

  __pycache__/    Compiled Python. Regenerated automatically.


----------------------------------------------------------------
 IF SOMETHING GOES WRONG
----------------------------------------------------------------

  "python is not recognized" / window flashes and closes
      -> Python is not on PATH. Run SETUP.bat. If it still
         fails, uninstall Python and reinstall from
         python.org with "Add python.exe to PATH" ticked.

  "npm is not recognized" or puppeteer errors
      -> Close every window and run SETUP.bat again. If
         npm install failed, it usually means no internet or a
         firewall - the red text in the window says which.

  The automation opens Chrome but Flow asks you to sign in
      -> Expected on a new PC. Sign in once. Step 4 above.

  It cannot find Chrome
      -> Install Chrome from google.com/chrome and run SETUP.bat
         again - the tool checks all standard install locations.

  Anything else
      -> The README.md in this folder is the full documentation.
