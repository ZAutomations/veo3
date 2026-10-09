@echo off
setlocal
title VEO3 Flow Launcher
cd /d "%~dp0"
call "%~dp0Setup\environment.bat"
if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" "%~dp0veo3_gui.py"
    goto :done
)
py -3 -c "import tkinter" >nul 2>&1
if not errorlevel 1 (
    py -3 "%~dp0veo3_gui.py"
    goto :done
)
python -c "import tkinter" >nul 2>&1
if not errorlevel 1 (
    python "%~dp0veo3_gui.py"
    goto :done
)
echo Python with tkinter was not found. Run SETUP.bat first.
:done
if errorlevel 1 pause
