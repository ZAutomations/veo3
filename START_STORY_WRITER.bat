@echo off
setlocal
cd /d "%~dp0"
if exist "Setup\environment.bat" call "Setup\environment.bat"
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" story_writer_gui.py
    goto :done
) else (
    py -3 -c "import tkinter" >nul 2>&1
    if not errorlevel 1 (
        py -3 story_writer_gui.py
        goto :done
    )
)
python story_writer_gui.py
:done
if errorlevel 1 pause
